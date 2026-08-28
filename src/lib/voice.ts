import { social, type RealtimeEvent } from "./social";

export type CallMediaKind = "microphone" | "camera" | "screen";
export type StreamQuality = "720p" | "1080p" | "1440p" | "source";
export type StreamSettings = { quality: StreamQuality; fps: 15 | 30 | 60; bitrateMbps: 2 | 4 | 6 | 8 | 10 };
export type AudioProcessingSettings = { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };

export const defaultStreamSettings: StreamSettings = { quality: "1080p", fps: 30, bitrateMbps: 6 };
export const defaultAudioProcessing: AudioProcessingSettings = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export type RemoteMedia = { userId: string; kind: CallMediaKind; stream: MediaStream; active: boolean };

type PeerState = {
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: RTCIceCandidateInit[];
};

type VoiceManagerOptions = {
  currentUserId: string;
  channelId: string;
  audioProcessing: AudioProcessingSettings;
  audioDeviceId?: string;
  onRemoteMedia: (media: RemoteMedia) => void;
  onLocalMedia: (kind: CallMediaKind, stream: MediaStream | null) => void;
  onPing: (milliseconds: number | null) => void;
  onError: (message: string) => void;
};

function mediaKey(userId: string, streamId: string) {
  return `${userId}:${streamId}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Permissão recusada pelo sistema.";
  return error instanceof Error ? error.message : fallback;
}

export class VoiceCallManager {
  private peers = new Map<string, PeerState>();
  private localStreams = new Map<CallMediaKind, MediaStream>();
  private remoteStreams = new Map<string, { userId: string; stream: MediaStream; kind: CallMediaKind }>();
  private mediaKinds = new Map<string, CallMediaKind>();
  private iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  private statsTimer?: number;
  private connected = false;
  private muted = false;
  private screenSettings: StreamSettings | null = null;

  constructor(private options: VoiceManagerOptions) {}

  async start() {
    if (this.connected) return;
    if (!navigator.mediaDevices || typeof RTCPeerConnection === "undefined") throw new Error("Este sistema não disponibilizou WebRTC para o Workdeck.");
    this.iceServers = (await social.rtcConfig().catch(() => null))?.iceServers ?? this.iceServers;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: this.microphoneConstraints(this.options.audioDeviceId),
        video: false
      });
      this.setLocalStream("microphone", microphone);
    } catch (error) {
      this.options.onError(`Você entrou sem microfone. ${errorMessage(error, "Não foi possível abrir o microfone")}`);
    }
    this.connected = true;
    social.sendRealtime({ type: "voice.join", channelId: this.options.channelId });
    this.statsTimer = window.setInterval(() => void this.collectStats(), 2_000);
  }

  handleEvent(event: RealtimeEvent) {
    if (event.type === "realtime.ready" && this.connected) {
      social.sendRealtime({ type: "voice.join", channelId: this.options.channelId });
      return;
    }
    if (event.type === "voice.snapshot" && event.channelId === this.options.channelId) {
      for (const [mediaKind, stream] of this.localStreams) {
        social.sendRealtime({ type: "voice.media", channelId: this.options.channelId, streamId: stream.id, mediaKind, active: true });
      }
      for (const participant of event.participants) {
        if (participant.userId !== this.options.currentUserId) void this.createOffer(participant.userId);
      }
      return;
    }
    if (event.type === "voice.participant" && event.action === "joined" && event.participant.channelId === this.options.channelId && event.participant.userId !== this.options.currentUserId) {
      // A newcomer receives the existing voice snapshot, but the snapshot only
      // carries the participant state. Re-announce stream ids so a screen track
      // can be identified as screen (instead of being guessed as camera) before
      // its first WebRTC track arrives.
      for (const [mediaKind, stream] of this.localStreams) {
        social.sendRealtime({ type: "voice.media", channelId: this.options.channelId, streamId: stream.id, mediaKind, active: true });
      }
      return;
    }
    if (event.type === "voice.signal" && event.channelId === this.options.channelId) {
      void this.handleSignal(event.userId, event.signal).catch((error) => this.options.onError(errorMessage(error, "Falha ao negociar a chamada")));
      return;
    }
    if (event.type === "voice.media" && event.channelId === this.options.channelId) {
      const key = mediaKey(event.userId, event.streamId);
      this.mediaKinds.set(key, event.mediaKind);
      const known = this.remoteStreams.get(key);
      if (known) {
        known.kind = event.mediaKind;
        this.options.onRemoteMedia({ userId: event.userId, kind: event.mediaKind, stream: known.stream, active: event.active });
      }
      return;
    }
    if (event.type === "voice.participant" && event.action === "left" && event.participant.channelId === this.options.channelId) {
      this.closePeer(event.participant.userId);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    for (const track of this.localStreams.get("microphone")?.getAudioTracks() ?? []) track.enabled = !muted;
    if (this.connected) social.sendRealtime({ type: "voice.update", channelId: this.options.channelId, muted });
  }

  isMuted() {
    return this.muted;
  }

  async setMicrophone(deviceId?: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: this.microphoneConstraints(deviceId),
        video: false
      });
      for (const track of stream.getAudioTracks()) track.enabled = !this.muted;
      this.options.audioDeviceId = deviceId;
      this.setLocalStream("microphone", stream);
    } catch (error) {
      throw new Error(errorMessage(error, "Não foi possível trocar o microfone"));
    }
  }

  async setCamera(enabled: boolean) {
    if (!enabled) {
      this.removeLocalStream("camera");
      social.sendRealtime({ type: "voice.update", channelId: this.options.channelId, cameraEnabled: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: false
      });
      this.setLocalStream("camera", stream);
      social.sendRealtime({ type: "voice.update", channelId: this.options.channelId, cameraEnabled: true });
    } catch (error) {
      throw new Error(errorMessage(error, "Não foi possível abrir a câmera"));
    }
  }

  async startScreenShare(settings: StreamSettings) {
    const sizes: Record<Exclude<StreamQuality, "source">, { width: number; height: number }> = {
      "720p": { width: 1280, height: 720 },
      "1080p": { width: 1920, height: 1080 },
      "1440p": { width: 2560, height: 1440 }
    };
    const size = settings.quality === "source" ? null : sizes[settings.quality];
    try {
      const supported = navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean };
      const sharedAudio = {
        echoCancellation: true,
        noiseSuppression: true,
        ...(supported.restrictOwnAudio ? { restrictOwnAudio: true } : {})
      };
      const displayOptions = {
        video: {
          ...(size ? { width: { ideal: size.width, max: size.width }, height: { ideal: size.height, max: size.height } } : {}),
          frameRate: { ideal: settings.fps, max: settings.fps }
        },
        audio: sharedAudio,
        systemAudio: "include",
        windowAudio: "window",
        surfaceSwitching: "include",
        selfBrowserSurface: "exclude"
      } as unknown as DisplayMediaStreamOptions;
      const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("Nenhuma tela foi selecionada");
      videoTrack.contentHint = "detail";
      videoTrack.addEventListener("ended", () => this.stopScreenShare(), { once: true });
      this.setLocalStream("screen", stream);
      this.screenSettings = settings;
      await this.applyScreenEncoding(settings);
      social.sendRealtime({ type: "voice.update", channelId: this.options.channelId, screenSharing: true });
    } catch (error) {
      throw new Error(errorMessage(error, "Não foi possível compartilhar a tela"));
    }
  }

  stopScreenShare() {
    if (!this.localStreams.has("screen")) return;
    this.removeLocalStream("screen");
    this.screenSettings = null;
    if (this.connected) social.sendRealtime({ type: "voice.update", channelId: this.options.channelId, screenSharing: false });
  }

  localStream(kind: CallMediaKind) {
    return this.localStreams.get(kind) ?? null;
  }

  disconnect() {
    if (this.connected) {
      try { social.sendRealtime({ type: "voice.leave" }); } catch { /* realtime may already be gone */ }
    }
    this.connected = false;
    window.clearInterval(this.statsTimer);
    for (const kind of Array.from(this.localStreams.keys())) this.removeLocalStream(kind, false);
    for (const userId of Array.from(this.peers.keys())) this.closePeer(userId);
    this.options.onPing(null);
  }

  private setLocalStream(kind: CallMediaKind, stream: MediaStream) {
    this.removeLocalStream(kind);
    this.localStreams.set(kind, stream);
    this.options.onLocalMedia(kind, stream);
    if (this.connected) social.sendRealtime({ type: "voice.media", channelId: this.options.channelId, streamId: stream.id, mediaKind: kind, active: true });
    for (const peer of this.peers.values()) {
      for (const track of stream.getTracks()) peer.connection.addTrack(track, stream);
    }
  }

  private microphoneConstraints(deviceId?: string): MediaTrackConstraints {
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: this.options.audioProcessing.echoCancellation,
      noiseSuppression: this.options.audioProcessing.noiseSuppression,
      autoGainControl: this.options.audioProcessing.autoGainControl
    };
  }

  private removeLocalStream(kind: CallMediaKind, announce = true) {
    const stream = this.localStreams.get(kind);
    if (!stream) return;
    this.localStreams.delete(kind);
    for (const peer of this.peers.values()) {
      for (const sender of peer.connection.getSenders()) {
        if (sender.track && stream.getTracks().includes(sender.track)) peer.connection.removeTrack(sender);
      }
    }
    for (const track of stream.getTracks()) track.stop();
    this.options.onLocalMedia(kind, null);
    if (announce && this.connected) {
      social.sendRealtime({ type: "voice.media", channelId: this.options.channelId, streamId: stream.id, mediaKind: kind, active: false });
    }
  }

  private peer(userId: string) {
    const existing = this.peers.get(userId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    const peer: PeerState = {
      connection,
      polite: this.options.currentUserId.localeCompare(userId) > 0,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: []
    };
    this.peers.set(userId, peer);
    for (const stream of this.localStreams.values()) {
      for (const track of stream.getTracks()) connection.addTrack(track, stream);
    }
    if (this.screenSettings) void this.applyScreenEncoding(this.screenSettings);
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) social.sendRealtime({ type: "voice.signal", channelId: this.options.channelId, targetUserId: userId, signal: { candidate: candidate.toJSON() } });
    };
    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        social.sendRealtime({ type: "voice.signal", channelId: this.options.channelId, targetUserId: userId, signal: { description: connection.localDescription } });
      } catch (error) {
        this.options.onError(errorMessage(error, "Falha ao atualizar a mídia da chamada"));
      } finally {
        peer.makingOffer = false;
      }
    };
    connection.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      const key = mediaKey(userId, stream.id);
      const kind = this.mediaKinds.get(key) ?? (track.kind === "audio" ? "microphone" : "camera");
      this.remoteStreams.set(key, { userId, stream, kind });
      this.options.onRemoteMedia({ userId, kind, stream, active: true });
      stream.addEventListener("removetrack", () => {
        if (stream.getTracks().every((candidate) => candidate.readyState === "ended")) {
          this.remoteStreams.delete(key);
          this.options.onRemoteMedia({ userId, kind, stream, active: false });
        }
      });
    };
    connection.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(connection.connectionState)) this.closePeer(userId);
    };
    return peer;
  }

  private async createOffer(userId: string) {
    const peer = this.peer(userId);
    if (peer.connection.signalingState !== "stable") return;
    peer.makingOffer = true;
    try {
      await peer.connection.setLocalDescription(await peer.connection.createOffer());
      social.sendRealtime({ type: "voice.signal", channelId: this.options.channelId, targetUserId: userId, signal: { description: peer.connection.localDescription } });
    } finally {
      peer.makingOffer = false;
    }
  }

  private async handleSignal(userId: string, rawSignal: unknown) {
    const signal = rawSignal as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    const peer = this.peer(userId);
    const connection = peer.connection;
    if (signal.description) {
      const readyForOffer = !peer.makingOffer && (connection.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
      const offerCollision = signal.description.type === "offer" && !readyForOffer;
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      peer.isSettingRemoteAnswerPending = signal.description.type === "answer";
      await connection.setRemoteDescription(signal.description);
      peer.isSettingRemoteAnswerPending = false;
      for (const candidate of peer.pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
      if (signal.description.type === "offer") {
        await connection.setLocalDescription(await connection.createAnswer());
        social.sendRealtime({ type: "voice.signal", channelId: this.options.channelId, targetUserId: userId, signal: { description: connection.localDescription } });
      }
      return;
    }
    if (signal.candidate) {
      if (!connection.remoteDescription) peer.pendingCandidates.push(signal.candidate);
      else await connection.addIceCandidate(signal.candidate).catch((error) => { if (!peer.ignoreOffer) throw error; });
    }
  }

  private async applyScreenEncoding(settings: StreamSettings) {
    const screenTrack = this.localStreams.get("screen")?.getVideoTracks()[0];
    if (!screenTrack) return;
    await Promise.all(Array.from(this.peers.values()).map(async ({ connection }) => {
      const sender = connection.getSenders().find((candidate) => candidate.track === screenTrack);
      if (!sender) return;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = settings.bitrateMbps * 1_000_000;
      parameters.encodings[0].maxFramerate = settings.fps;
      await sender.setParameters(parameters).catch(() => undefined);
    }));
  }

  private async collectStats() {
    const samples: number[] = [];
    for (const { connection } of this.peers.values()) {
      const reports = await connection.getStats().catch(() => null);
      reports?.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded" && typeof report.currentRoundTripTime === "number") {
          samples.push(Math.round(report.currentRoundTripTime * 1000));
        }
      });
    }
    this.options.onPing(samples.length ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : null);
  }

  private closePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.connection.close();
    this.peers.delete(userId);
    for (const [key, remote] of this.remoteStreams) {
      if (remote.userId !== userId) continue;
      this.remoteStreams.delete(key);
      this.options.onRemoteMedia({ userId, kind: remote.kind, stream: remote.stream, active: false });
    }
  }
}
