export type SignalPayload =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export type TransferProgress = {
  transferred: number;
  total: number;
};

export type IncomingPeerFile = {
  name: string;
  size: number;
  mime: string;
  blob: Blob;
};

const audioExtensions = new Set(["aac", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "webm"]);
const imageExtensions = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);

export function previewKindForFile(name: string, mime: string): "audio" | "image" | undefined {
  const normalizedMime = mime.toLowerCase();
  if (normalizedMime.startsWith("audio/")) return "audio";
  if (normalizedMime.startsWith("image/")) return "image";
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (audioExtensions.has(extension)) return "audio";
  if (imageExtensions.has(extension)) return "image";
  return undefined;
}

/**
 * WebRTC data-channel transport used by chat. The production presence service
 * only relays encrypted SDP/ICE signals; file bytes go directly peer-to-peer.
 */
export class PeerFileTransport {
  private peer: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private onSignal: (signal: SignalPayload) => void;
  private onIncomingFile?: (file: IncomingPeerFile) => void;
  private onReceiveProgress?: (progress: TransferProgress) => void;
  private pendingIce: RTCIceCandidateInit[] = [];
  private incomingMeta?: { name: string; size: number; mime: string };
  private incomingChunks: BlobPart[] = [];
  private incomingBytes = 0;

  constructor(
    onSignal: (signal: SignalPayload) => void,
    options: { onIncomingFile?: (file: IncomingPeerFile) => void; onReceiveProgress?: (progress: TransferProgress) => void } = {}
  ) {
    this.onSignal = onSignal;
    this.onIncomingFile = options.onIncomingFile;
    this.onReceiveProgress = options.onReceiveProgress;
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    this.peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.onSignal({ type: "ice", candidate: candidate.toJSON() });
    };
    this.peer.ondatachannel = ({ channel }) => this.configureChannel(channel);
  }

  async createOffer() {
    this.configureChannel(this.peer.createDataChannel("workdeck-file", { ordered: true }));
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    this.onSignal({ type: "offer", sdp: offer });
  }

  async acceptSignal(signal: SignalPayload) {
    if (signal.type === "ice") {
      if (this.peer.remoteDescription) await this.peer.addIceCandidate(signal.candidate);
      else this.pendingIce.push(signal.candidate);
      return;
    }
    await this.peer.setRemoteDescription(signal.sdp);
    for (const candidate of this.pendingIce.splice(0)) await this.peer.addIceCandidate(candidate);
    if (signal.type === "offer") {
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      this.onSignal({ type: "answer", sdp: answer });
    }
  }

  async send(file: File, onProgress: (progress: TransferProgress) => void) {
    const channel = await this.waitForChannel();
    const chunkSize = 64 * 1024;
    channel.send(JSON.stringify({ kind: "meta", name: file.name, size: file.size, mime: file.type }));
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      while (channel.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      channel.send(await file.slice(offset, offset + chunkSize).arrayBuffer());
      onProgress({ transferred: Math.min(offset + chunkSize, file.size), total: file.size });
    }
    channel.send(JSON.stringify({ kind: "complete" }));
  }

  close() {
    this.channel?.close();
    this.peer.close();
  }

  private configureChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onmessage = ({ data }) => {
      if (typeof data === "string") {
        const event = JSON.parse(data) as { kind: string; name?: string; size?: number; mime?: string };
        if (event.kind === "meta" && event.name && typeof event.size === "number") {
          this.incomingMeta = { name: event.name, size: event.size, mime: event.mime || "application/octet-stream" };
          this.incomingChunks = [];
          this.incomingBytes = 0;
        }
        if (event.kind === "complete" && this.incomingMeta) {
          this.onIncomingFile?.({ ...this.incomingMeta, blob: new Blob(this.incomingChunks, { type: this.incomingMeta.mime }) });
        }
        return;
      }
      if (!this.incomingMeta) return;
      this.incomingChunks.push(data as ArrayBuffer);
      this.incomingBytes += (data as ArrayBuffer).byteLength;
      this.onReceiveProgress?.({ transferred: this.incomingBytes, total: this.incomingMeta.size });
    };
  }

  private waitForChannel() {
    return new Promise<RTCDataChannel>((resolve, reject) => {
      if (this.channel?.readyState === "open") return resolve(this.channel);
      const timeout = window.setTimeout(() => reject(new Error("Peer connection timed out")), 60_000);
      const accept = (channel: RTCDataChannel) => {
        const opened = () => {
          window.clearTimeout(timeout);
          resolve(channel);
        };
        if (channel.readyState === "open") opened();
        else channel.addEventListener("open", opened, { once: true });
      };
      if (this.channel) accept(this.channel);
      else this.peer.addEventListener("datachannel", ({ channel }) => { this.configureChannel(channel); accept(channel); }, { once: true });
    });
  }
}

export async function runP2PSelfTest() {
  let sender!: PeerFileTransport;
  let receiver!: PeerFileTransport;
  let finish!: (file: IncomingPeerFile) => void;
  const received = new Promise<IncomingPeerFile>((resolve, reject) => {
    finish = resolve;
    window.setTimeout(() => reject(new Error("O teste P2P excedeu o tempo limite")), 20_000);
  });
  receiver = new PeerFileTransport((signal) => { void sender.acceptSignal(signal); }, { onIncomingFile: finish });
  sender = new PeerFileTransport((signal) => { void receiver.acceptSignal(signal); });
  try {
    const expected = "Workdeck P2P funcionando neste computador.";
    await sender.createOffer();
    await sender.send(new File([expected], "workdeck-p2p-test.txt", { type: "text/plain" }), () => undefined);
    const result = await received;
    if (await result.blob.text() !== expected) throw new Error("O arquivo chegou diferente do original");
    return { name: result.name, bytes: result.size };
  } finally { sender.close(); receiver.close(); }
}
