import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  Hash,
  Headphones,
  Link2,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Paperclip,
  Plus,
  Radio,
  Send,
  Settings2,
  ShieldCheck,
  Signal,
  UserPlus,
  Users,
  Video,
  Volume2,
  X,
  ZoomIn
} from "lucide-react";
import { social, type ApiCommunity, type ApiFriend, type CommunityInvite, type CommunityMember, type CommunityMessage, type RealtimeEvent, type SocialUser, type VoiceParticipant } from "../lib/social";
import { formatFileSize } from "../lib/format";
import { PeerFileTransport, previewKindForFile, type SignalPayload } from "../lib/p2p";
import { openSavedFile, revealSavedFile, saveReceivedFile } from "../lib/save-file";
import { openStreamPopout } from "../lib/stream-popout";
import { defaultAudioProcessing, defaultStreamSettings, VoiceCallManager, type AudioProcessingSettings, type CallMediaKind, type RemoteMedia, type StreamQuality, type StreamSettings } from "../lib/voice";

type StudiosViewProps = {
  currentUser: SocialUser;
  friends: ApiFriend[];
  pendingInviteCode: string | null;
  onInviteHandled: () => void;
  onOpenDm: (userId: string, file?: File, member?: CommunityMember) => void;
  onToast: (message: string) => void;
  onCallStateChange: (call: { communityName: string; channelName: string } | null) => void;
};

type LocalMedia = Partial<Record<CallMediaKind, MediaStream>>;
type StudioTransfer = {
  state: "offered" | "transferring" | "complete" | "failed";
  direction: "incoming" | "outgoing";
  progress: number;
  blob?: Blob;
  previewKind?: "audio" | "image";
  previewUrl?: string;
  saved?: boolean;
  savedPath?: string;
  saving?: boolean;
};

const communityColors = ["#72e3a2", "#8aa8ff", "#b693ff", "#ff9c72", "#f3c968", "#67d7da"];

function readStored<T>(key: string, fallback: T): T {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? "{}") } as T; } catch { return fallback; }
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function MediaView({ stream, muted = false, className = "" }: { stream: MediaStream; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function AudioView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function MemberAvatar({ member, small = false }: { member: Pick<CommunityMember, "displayName" | "avatarColor" | "avatarUrl" | "status">; small?: boolean }) {
  return <span className={`studio-avatar ${small ? "studio-avatar-small" : ""}`} style={{ backgroundColor: member.avatarColor, backgroundImage: member.avatarUrl ? `url(${member.avatarUrl})` : undefined }}>{!member.avatarUrl && initials(member.displayName)}<i className={`presence-${member.status}`} /></span>;
}

function MemberPopover({ member, currentUserId, onClose, onOpenDm }: { member: CommunityMember; currentUserId: string; onClose: () => void; onOpenDm: (userId: string, file?: File, member?: CommunityMember) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const stageFile = (file?: File) => { if (file) onOpenDm(member.id, file, member); };
  return (
    <div className="studio-member-popover" onClick={(event) => event.stopPropagation()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); stageFile(event.dataTransfer.files[0]); }}>
      <button className="studio-popover-close" onClick={onClose}><X size={14} /></button>
      <div className="studio-profile-banner" style={{ background: member.avatarColor }} />
      <MemberAvatar member={member} />
      <strong>{member.displayName}</strong><span>@{member.handle}</span>
      {member.currentAppName ? <div className="studio-profile-working"><span>TRABALHANDO AGORA</span><b>{member.currentAppName}</b></div> : <div className="studio-profile-working is-idle"><span>ATIVIDADE</span><b>{member.status === "offline" ? "Offline" : "Disponível"}</b></div>}
      {member.id !== currentUserId && <div className="studio-profile-actions"><button onClick={() => onOpenDm(member.id, undefined, member)}><MessageCircle size={14} /> Mensagem</button><button onClick={() => fileInput.current?.click()}><FileUp size={14} /> Arquivo</button><input ref={fileInput} hidden type="file" onChange={(event) => stageFile(event.target.files?.[0])} /></div>}
      {member.id !== currentUserId && <small>Ou arraste um arquivo aqui para abrir o envio P2P.</small>}
    </div>
  );
}

function StreamSetup({ value, onChange, onStart, onClose }: { value: StreamSettings; onChange: (value: StreamSettings) => void; onStart: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}><section className="modal studio-stream-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="eyebrow">Transmissão P2P</span><h2>Compartilhar sua tela</h2></div><button onClick={onClose}><X size={18} /></button></div>
      <p className="studio-modal-copy">Sua configuração fica salva para a próxima live. A qualidade real também depende da conexão de quem transmite e assiste.</p>
      <div className="studio-quality-grid">
        <label>Qualidade<select value={value.quality} onChange={(event) => onChange({ ...value, quality: event.target.value as StreamQuality })}><option value="720p">720p</option><option value="1080p">1080p</option><option value="1440p">1440p</option><option value="source">SOURCE</option></select></label>
        <label>FPS<select value={value.fps} onChange={(event) => onChange({ ...value, fps: Number(event.target.value) as 15 | 30 | 60 })}><option value="15">15 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label>
        <label>Bitrate<select value={value.bitrateMbps} onChange={(event) => onChange({ ...value, bitrateMbps: Number(event.target.value) as 2 | 4 | 6 | 8 | 10 })}><option value="2">2 Mbps</option><option value="4">4 Mbps</option><option value="6">6 Mbps</option><option value="8">8 Mbps</option><option value="10">10 Mbps</option></select></label>
      </div>
      <div className="studio-stream-note"><ShieldCheck size={16} /><span>Vídeo, áudio da tela e câmera usam conexão WebRTC criptografada. A VPS só ajuda os participantes a se encontrarem ou faz relay quando uma rede bloqueia o P2P direto.</span></div>
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={onStart}><MonitorUp size={16} /> Escolher tela</button></div>
    </section></div>
  );
}

function AudioSettings({ value, onChange, onClose }: { value: AudioProcessingSettings; onChange: (value: AudioProcessingSettings) => void; onClose: () => void }) {
  const toggles: Array<[keyof AudioProcessingSettings, string, string]> = [
    ["echoCancellation", "Cancelamento de eco", "Evita que o som dos participantes volte para o microfone."],
    ["noiseSuppression", "Supressão de ruído", "Reduz ventilador, teclado e ruídos constantes."],
    ["autoGainControl", "Ganho automático", "Mantém o volume da sua voz mais uniforme."]
  ];
  return <div className="studio-audio-settings"><div><strong>Tratamento do microfone</strong><button onClick={onClose}><X size={14} /></button></div>{toggles.map(([key, title, copy]) => <label key={key}><span><b>{title}</b><small>{copy}</small></span><input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} /></label>)}<p>As mudanças passam a valer ao entrar novamente na call.</p></div>;
}

function CommunityModal({ mode, onClose, onCreated, onJoined }: { mode: "create" | "join"; onClose: () => void; onCreated: (community: ApiCommunity) => void; onJoined: (communityId: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(communityColors[0]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (mode === "create") onCreated(await social.createCommunity({ name, description, iconColor: color }));
      else {
        const normalized = code.trim().split("/").filter(Boolean).at(-1)?.replace(/^workdeck:\/\/invite\//, "") ?? "";
        const result = await social.acceptCommunityInvite(normalized);
        onJoined(result.communityId);
      }
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível continuar"); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal studio-create-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">Studios</span><h2>{mode === "create" ? "Criar uma comunidade" : "Entrar em uma comunidade"}</h2></div><button onClick={onClose}><X size={18} /></button></div>{mode === "create" ? <><label className="field-label">Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ex.: Motion Club" autoFocus /></label><label className="field-label">Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="Sobre o que vocês trabalham?" /></label><div className="studio-color-picker"><span>Cor</span>{communityColors.map((candidate) => <button key={candidate} className={color === candidate ? "selected" : ""} style={{ background: candidate }} onClick={() => setColor(candidate)}>{color === candidate && <Check size={13} />}</button>)}</div></> : <label className="field-label">Link ou código do convite<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Cole o convite aqui" autoFocus /></label>}{error && <div className="chat-error">{error}</div>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || (mode === "create" ? name.trim().length < 2 : code.trim().length < 8)} onClick={() => void submit()}>{busy ? "Aguarde…" : mode === "create" ? "Criar Studio" : "Entrar"}</button></div></section></div>;
}

function InviteModal({ community, friends, onClose, onToast }: { community: ApiCommunity; friends: ApiFriend[]; onClose: () => void; onToast: (message: string) => void }) {
  const [url, setUrl] = useState("");
  const [busyFriend, setBusyFriend] = useState("");
  useEffect(() => { void social.createCommunityInvite(community.id).then((result) => setUrl(result.url)).catch((error) => onToast(error.message)); }, [community.id, onToast]);
  const inviteFriend = async (friend: ApiFriend) => {
    setBusyFriend(friend.id);
    try { await social.inviteFriendToCommunity(community.id, friend.id); onToast(`Convite enviado para ${friend.displayName}`); }
    catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível convidar"); }
    finally { setBusyFriend(""); }
  };
  const available = friends.filter((friend) => !community.members.some((member) => member.id === friend.id));
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal studio-invite-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">Convidar para</span><h2>{community.name}</h2></div><button onClick={onClose}><X size={18} /></button></div><label className="studio-invite-link"><input readOnly value={url || "Gerando convite…"} /><button disabled={!url} onClick={() => { void navigator.clipboard.writeText(url); onToast("Link copiado"); }}><Copy size={15} /> Copiar</button></label><p className="studio-modal-copy">O link abre o Workdeck diretamente. Ele expira em sete dias.</p><div className="studio-invite-friends">{available.map((friend) => <article key={friend.id}><span className="studio-avatar studio-avatar-small" style={{ backgroundColor: friend.avatarColor, backgroundImage: friend.avatarUrl ? `url(${friend.avatarUrl})` : undefined }}>{!friend.avatarUrl && initials(friend.displayName)}</span><div><strong>{friend.displayName}</strong><span>@{friend.handle}</span></div><button disabled={busyFriend === friend.id} onClick={() => void inviteFriend(friend)}>{busyFriend === friend.id ? "Enviando…" : "Convidar"}</button></article>)}{!available.length && <div className="studio-empty-mini">Todos os seus amigos já estão aqui.</div>}</div></section></div>;
}

function ChannelModal({ kind, onClose, onCreate }: { kind: "text" | "voice"; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal studio-channel-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">Novo canal</span><h2>{kind === "text" ? "Canal de texto" : "Canal de voz"}</h2></div><button onClick={onClose}><X size={18} /></button></div><label className="field-label">Nome<div className="studio-channel-name-input">{kind === "text" ? <Hash size={15} /> : <Volume2 size={15} />}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder={kind === "text" ? "revisões" : "Sala de criação"} autoFocus /></div></label><p className="studio-modal-copy">{kind === "voice" ? "Todo canal de voz já vem com um chat próprio." : "Todos os membros da comunidade poderão ler e conversar."}</p><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); try { await onCreate(name.trim()); onClose(); } finally { setBusy(false); } }}>{busy ? "Criando…" : "Criar canal"}</button></div></section></div>;
}

function StudioFileCard({ message, transfer, onAccept, onSave, onOpen, onReveal, onZoom }: { message: CommunityMessage; transfer?: StudioTransfer; onAccept: () => void; onSave: () => void; onOpen: () => void; onReveal: () => void; onZoom: (url: string) => void }) {
  if (!message.file) return null;
  const incoming = transfer?.direction === "incoming";
  return <div className="studio-file-card">
    {transfer?.previewKind === "image" && transfer.previewUrl && <button className="studio-file-preview" onClick={() => onZoom(transfer.previewUrl!)}><img src={transfer.previewUrl} alt={message.file.name} /><span><ZoomIn size={15} /> Ampliar</span></button>}
    {transfer?.previewKind === "audio" && transfer.previewUrl && <audio controls preload="metadata" src={transfer.previewUrl} />}
    <div className="studio-file-info"><Paperclip size={17} /><span><strong>{message.file.name}</strong><small>{formatFileSize(message.file.size)} · envio P2P</small></span></div>
    {incoming && !transfer?.blob && <button className="studio-file-action" onClick={onAccept}><Download size={15} /> Receber arquivo</button>}
    {transfer?.state === "transferring" && <div className="studio-file-progress"><i style={{ width: `${Math.round(transfer.progress * 100)}%` }} /><span>{Math.round(transfer.progress * 100)}%</span></div>}
    {transfer?.blob && !transfer.saved && <button className="studio-file-action" disabled={transfer.saving} onClick={onSave}><Download size={15} /> {transfer.saving ? "Salvando…" : "Salvar arquivo"}</button>}
    {transfer?.saved && transfer.savedPath && <div className="studio-file-saved"><button onClick={onOpen}><ExternalLink size={14} /> Abrir</button><button onClick={onReveal}><FolderOpen size={14} /> Mostrar na pasta</button></div>}
    {transfer?.direction === "outgoing" && transfer.state === "offered" && <small className="studio-file-waiting">Aguardando alguém receber…</small>}
    {transfer?.state === "failed" && <small className="studio-file-error">Falha na conexão P2P. Tente novamente.</small>}
  </div>;
}

function ChannelMessages({ channel, messages, currentUserId, transfers, onSend, onQueueFile, onAcceptFile, onSaveFile, onOpenFile, onRevealFile, onZoomImage }: { channel: { id: string; name: string; kind: "text" | "voice" }; messages: CommunityMessage[]; currentUserId: string; transfers: Record<string, StudioTransfer>; onSend: (body: string) => Promise<void>; onQueueFile: (file: File) => void; onAcceptFile: (message: CommunityMessage) => void; onSaveFile: (message: CommunityMessage) => void; onOpenFile: (message: CommunityMessage) => void; onRevealFile: (message: CommunityMessage) => void; onZoomImage: (url: string) => void }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  const send = async () => { const body = text.trim(); if (!body) return; setText(""); await onSend(body); };
  return <section className={`studio-channel-chat ${channel.kind === "voice" ? "voice-channel-chat" : ""}`}><header><div>{channel.kind === "voice" ? <Volume2 size={17} /> : <Hash size={17} />}<strong>{channel.name}</strong></div>{channel.kind === "voice" && <span>Chat da call</span>}</header><div className="studio-message-scroll">{!messages.length && <div className="studio-conversation-start"><span>{channel.kind === "voice" ? <Volume2 size={25} /> : <Hash size={25} />}</span><h3>Começo de #{channel.name}</h3><p>As mensagens ficam salvas para os membros desta comunidade.</p></div>}{messages.map((message, index) => { const previous = messages[index - 1]; const grouped = previous?.senderId === message.senderId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000; return <article key={message.id} className={`studio-message ${grouped ? "grouped" : ""} ${message.senderId === currentUserId ? "mine" : ""}`}>{!grouped && <span className="studio-message-avatar" style={{ background: message.author.avatarColor, backgroundImage: message.author.avatarUrl ? `url(${message.author.avatarUrl})` : undefined }}>{!message.author.avatarUrl && initials(message.author.displayName)}</span>}<div>{!grouped && <header><strong>{message.author.displayName}</strong><time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></header>}{message.body && <p>{message.body}</p>}{message.file && <StudioFileCard message={message} transfer={transfers[message.file.transferId]} onAccept={() => onAcceptFile(message)} onSave={() => onSaveFile(message)} onOpen={() => onOpenFile(message)} onReveal={() => onRevealFile(message)} onZoom={onZoomImage} />}</div></article>; })}<div ref={endRef} /></div><form className="studio-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><input ref={fileInput} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) onQueueFile(file); event.target.value = ""; }} /><button type="button" title="Enviar arquivo P2P" onClick={() => fileInput.current?.click()}><Paperclip size={17} /></button><input value={text} onChange={(event) => setText(event.target.value)} placeholder={`Conversar em #${channel.name}`} /><button disabled={!text.trim()}><Send size={16} /></button></form></section>;
}

export function StudiosView({ currentUser, friends, pendingInviteCode, onInviteHandled, onOpenDm, onToast, onCallStateChange }: StudiosViewProps) {
  const [communities, setCommunities] = useState<ApiCommunity[]>([]);
  const [selectedCommunityId, setSelectedCommunityId] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<CommunityInvite[]>([]);
  const [modal, setModal] = useState<"create" | "join" | "invite" | "stream" | null>(null);
  const [showChannelMenu, setShowChannelMenu] = useState(false);
  const [channelKind, setChannelKind] = useState<"text" | "voice" | null>(null);
  const [profileMember, setProfileMember] = useState<CommunityMember | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [joinedChannelId, setJoinedChannelId] = useState<string | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<RemoteMedia[]>([]);
  const [localMedia, setLocalMedia] = useState<LocalMedia>({});
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [ping, setPing] = useState<number | null>(null);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [streamSettings, setStreamSettings] = useState<StreamSettings>(() => readStored("workdeck.stream-settings", defaultStreamSettings));
  const [audioSettings, setAudioSettings] = useState<AudioProcessingSettings>(() => readStored("workdeck.audio-processing", defaultAudioProcessing));
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(() => localStorage.getItem("workdeck.microphone-device") ?? "");
  const [rightPanel, setRightPanel] = useState<"members" | "friends">("members");
  const [channelWidth, setChannelWidth] = useState(() => Number(localStorage.getItem("workdeck.studio-channel-width")) || 232);
  const [memberWidth, setMemberWidth] = useState(() => Number(localStorage.getItem("workdeck.studio-member-width")) || 220);
  const [voiceChatWidth, setVoiceChatWidth] = useState(() => Number(localStorage.getItem("workdeck.studio-voice-chat-width")) || 300);
  const [transfers, setTransfers] = useState<Record<string, StudioTransfer>>({});
  const [pendingAttachment, setPendingAttachmentState] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const manager = useRef<VoiceCallManager | null>(null);
  const fileTransports = useRef(new Map<string, PeerFileTransport>());
  const pendingOutgoing = useRef(new Map<string, { file: File; messageId: string }>());
  const previewUrls = useRef(new Set<string>());

  const selectedCommunity = communities.find((community) => community.id === selectedCommunityId) ?? null;
  const selectedChannel = selectedCommunity?.channels.find((channel) => channel.id === selectedChannelId) ?? null;

  const refreshAudioDevices = useCallback(async () => {
    const devices = (await navigator.mediaDevices?.enumerateDevices?.() ?? []).filter((device) => device.kind === "audioinput");
    setAudioDevices(devices);
    if (selectedAudioDevice && !devices.some((device) => device.deviceId === selectedAudioDevice)) setSelectedAudioDevice("");
  }, [selectedAudioDevice]);

  const resizeDivider = (kind: "channels" | "members" | "voice", event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const initial = kind === "channels" ? channelWidth : kind === "members" ? memberWidth : voiceChatWidth;
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = kind === "channels" ? Math.min(380, Math.max(180, initial + delta)) : kind === "members" ? Math.min(360, Math.max(180, initial - delta)) : Math.min(520, Math.max(240, initial - delta));
      if (kind === "channels") setChannelWidth(next); else if (kind === "members") setMemberWidth(next); else setVoiceChatWidth(next);
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true });
  };

  const refresh = useCallback(async (preferredCommunityId?: string) => {
    const [nextCommunities, invites] = await Promise.all([social.communities(), social.communityInvites()]);
    setCommunities(nextCommunities);
    setIncomingInvites(invites);
    const communityId = preferredCommunityId ?? selectedCommunityId;
    const chosen = nextCommunities.find((community) => community.id === communityId) ?? nextCommunities[0];
    if (chosen) {
      setSelectedCommunityId(chosen.id);
      setSelectedChannelId((current) => chosen.channels.some((channel) => channel.id === current) ? current : chosen.channels.find((channel) => channel.kind === "text")?.id ?? chosen.channels[0]?.id ?? "");
      setParticipants(nextCommunities.flatMap((community) => community.members.filter((member) => member.voice).map((member) => ({ ...member, ...member.voice, userId: member.id } as VoiceParticipant))));
    }
  }, [selectedCommunityId]);

  useEffect(() => { void refresh().catch((reason) => onToast(reason instanceof Error ? reason.message : "Não foi possível carregar seus Studios")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedChannelId) return setMessages([]);
    void social.communityMessages(selectedChannelId).then(setMessages).catch((reason) => onToast(reason instanceof Error ? reason.message : "Não foi possível abrir o canal"));
  }, [selectedChannelId, onToast]);

  useEffect(() => {
    const unsubscribe = social.subscribe((event: RealtimeEvent) => {
      manager.current?.handleEvent(event);
      if (event.type === "webrtc.ready") {
        const pending = pendingOutgoing.current.get(event.transferId);
        if (pending) void social.rtcConfig().catch(() => ({ iceServers: undefined })).then(({ iceServers }) => {
          const key = `${event.transferId}:${event.userId}`;
          fileTransports.current.get(key)?.close();
          const transport = new PeerFileTransport((signal) => social.sendRealtime({ type: "webrtc.signal", targetUserId: event.userId, transferId: event.transferId, signal }), { iceServers });
          fileTransports.current.set(key, transport);
          setTransfers((current) => ({ ...current, [event.transferId]: { ...current[event.transferId], direction: "outgoing", state: "transferring", progress: 0 } }));
          void transport.createOffer().then(() => transport.send(pending.file, ({ transferred, total }) => setTransfers((current) => ({ ...current, [event.transferId]: { ...current[event.transferId], direction: "outgoing", state: transferred >= total ? "complete" : "transferring", progress: total ? transferred / total : 1 } })))).catch(() => setTransfers((current) => ({ ...current, [event.transferId]: { ...current[event.transferId], direction: "outgoing", state: "failed", progress: 0 } })));
        });
      }
      if (event.type === "webrtc.signal") {
        const transport = fileTransports.current.get(`${event.transferId}:${event.userId}`);
        if (transport) void transport.acceptSignal(event.signal as SignalPayload).catch(() => setTransfers((current) => ({ ...current, [event.transferId]: { ...current[event.transferId], state: "failed" } })));
      }
      if (event.type === "community.updated") void refresh(event.communityId);
      if (event.type === "community.invited") setIncomingInvites((current) => [event.invite, ...current.filter((invite) => invite.id !== event.invite.id)]);
      if (event.type === "community.message" && event.message.channelId === selectedChannelId) setMessages((current) => current.some((message) => message.id === event.message.id) ? current : [...current, event.message]);
      if (event.type === "presence.updated") {
        setCommunities((current) => current.map((community) => ({ ...community, members: community.members.map((member) => member.id === event.userId ? { ...member, status: event.presence.status, currentAppId: event.presence.currentAppId, currentAppName: event.presence.currentAppName, sessionStartedAt: event.presence.sessionStartedAt } : member) })));
        setParticipants((current) => current.map((participant) => participant.userId === event.userId ? { ...participant, status: event.presence.status, currentAppId: event.presence.currentAppId, currentAppName: event.presence.currentAppName } : participant));
      }
      if (event.type === "voice.snapshot") setParticipants((current) => [...current.filter((participant) => participant.channelId !== event.channelId), ...event.participants]);
      if (event.type === "voice.participant") {
        if (event.action === "left") setParticipants((current) => current.filter((participant) => participant.userId !== event.participant.userId));
        else setParticipants((current) => [...current.filter((participant) => participant.userId !== event.participant.userId), event.participant]);
      }
    });
    return unsubscribe;
  }, [refresh, selectedChannelId]);

  useEffect(() => () => {
    manager.current?.disconnect();
    for (const transport of fileTransports.current.values()) transport.close();
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    onCallStateChange(null);
  }, [onCallStateChange]);
  useEffect(() => { localStorage.setItem("workdeck.stream-settings", JSON.stringify(streamSettings)); }, [streamSettings]);
  useEffect(() => { localStorage.setItem("workdeck.audio-processing", JSON.stringify(audioSettings)); }, [audioSettings]);
  useEffect(() => { localStorage.setItem("workdeck.studio-channel-width", String(channelWidth)); }, [channelWidth]);
  useEffect(() => { localStorage.setItem("workdeck.studio-member-width", String(memberWidth)); }, [memberWidth]);
  useEffect(() => { localStorage.setItem("workdeck.studio-voice-chat-width", String(voiceChatWidth)); }, [voiceChatWidth]);
  useEffect(() => {
    void refreshAudioDevices().catch(() => undefined);
    const changed = () => void refreshAudioDevices().catch(() => undefined);
    navigator.mediaDevices?.addEventListener?.("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", changed);
  }, [refreshAudioDevices]);
  useEffect(() => {
    if (!pendingAttachment || !previewKindForFile(pendingAttachment.name, pendingAttachment.type)) return setPendingPreviewUrl(null);
    const url = URL.createObjectURL(pendingAttachment); setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAttachment]);

  useEffect(() => {
    if (!pendingInviteCode) return;
    void social.communityInvite(pendingInviteCode).then(({ invite, alreadyMember }) => {
      if (alreadyMember) { void refresh(invite.communityId); onToast(`Você já participa de ${invite.communityName}`); }
      else if (window.confirm(`Entrar na comunidade “${invite.communityName}” de ${invite.creatorName}?`)) void social.acceptCommunityInvite(pendingInviteCode).then((result) => refresh(result.communityId)).catch((error) => onToast(error.message));
    }).catch((error) => onToast(error.message)).finally(onInviteHandled);
  }, [pendingInviteCode, onInviteHandled, onToast, refresh]);

  const sendMessage = async (body: string) => {
    if (!selectedChannel) return;
    const message = await social.sendCommunityMessage(selectedChannel.id, { body });
    setMessages((current) => current.some((candidate) => candidate.id === message.id) ? current : [...current, message]);
  };

  const sendStudioFile = async () => {
    if (!pendingAttachment || !selectedChannel) return;
    const file = pendingAttachment;
    const transferId = crypto.randomUUID();
    try {
      const message = await social.sendCommunityMessage(selectedChannel.id, { file: { name: file.name, size: file.size, mime: file.type || "application/octet-stream", transferId } });
      pendingOutgoing.current.set(transferId, { file, messageId: message.id });
      const previewKind = previewKindForFile(file.name, file.type);
      const previewUrl = previewKind ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previewUrls.current.add(previewUrl);
      setTransfers((current) => ({ ...current, [transferId]: { direction: "outgoing", state: "offered", progress: 0, previewKind, previewUrl } }));
      setMessages((current) => current.some((candidate) => candidate.id === message.id) ? current : [...current, message]);
      setPendingAttachment(null);
    } catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível enviar o arquivo"); }
  };

  const setPendingAttachment = (file: File | null) => {
    if (file && file.size > 20 * 1024 * 1024 * 1024) { onToast("O arquivo excede o limite de 20 GB"); return; }
    setPendingAttachmentState(file);
  };

  const acceptStudioFile = async (message: CommunityMessage) => {
    if (!message.file) return;
    const { transferId } = message.file;
    const key = `${transferId}:${message.senderId}`;
    try {
      const { iceServers } = await social.rtcConfig();
      fileTransports.current.get(key)?.close();
      const transport = new PeerFileTransport((signal) => social.sendRealtime({ type: "webrtc.signal", targetUserId: message.senderId, transferId, signal }), {
        iceServers,
        onReceiveProgress: ({ transferred, total }) => setTransfers((current) => ({ ...current, [transferId]: { ...current[transferId], direction: "incoming", state: "transferring", progress: total ? transferred / total : 0 } })),
        onIncomingFile: ({ blob, name, mime }) => {
          const previewKind = previewKindForFile(name, mime);
          const previewUrl = previewKind ? URL.createObjectURL(blob) : undefined;
          if (previewUrl) previewUrls.current.add(previewUrl);
          setTransfers((current) => ({ ...current, [transferId]: { direction: "incoming", state: "complete", progress: 1, blob, previewKind, previewUrl, saving: true } }));
          void saveReceivedFile(name, blob).then((saved) => setTransfers((current) => ({ ...current, [transferId]: { ...current[transferId], saved: saved.saved, savedPath: saved.path, saving: false } }))).catch(() => setTransfers((current) => ({ ...current, [transferId]: { ...current[transferId], saving: false } })));
        }
      });
      fileTransports.current.set(key, transport);
      setTransfers((current) => ({ ...current, [transferId]: { direction: "incoming", state: "transferring", progress: 0 } }));
      social.sendRealtime({ type: "webrtc.ready", targetUserId: message.senderId, transferId });
    } catch (reason) { setTransfers((current) => ({ ...current, [transferId]: { direction: "incoming", state: "failed", progress: 0 } })); onToast(reason instanceof Error ? reason.message : "Não foi possível iniciar o P2P"); }
  };

  const saveStudioFile = async (message: CommunityMessage) => {
    if (!message.file) return;
    const transfer = transfers[message.file.transferId];
    if (!transfer?.blob || transfer.saving) return;
    setTransfers((current) => ({ ...current, [message.file!.transferId]: { ...transfer, saving: true } }));
    try { const saved = await saveReceivedFile(message.file.name, transfer.blob); setTransfers((current) => ({ ...current, [message.file!.transferId]: { ...current[message.file!.transferId], saved: saved.saved, savedPath: saved.path, saving: false } })); }
    catch { setTransfers((current) => ({ ...current, [message.file!.transferId]: { ...current[message.file!.transferId], saving: false } })); }
  };

  const joinCall = async (channelId: string) => {
    manager.current?.disconnect();
    setRemoteMedia([]); setLocalMedia({}); setParticipants((current) => current.filter((participant) => participant.channelId !== joinedChannelId));
    const next = new VoiceCallManager({
      currentUserId: currentUser.id,
      channelId,
      audioProcessing: audioSettings,
      audioDeviceId: selectedAudioDevice || undefined,
      onRemoteMedia(media) { setRemoteMedia((current) => media.active ? [...current.filter((candidate) => !(candidate.userId === media.userId && candidate.stream.id === media.stream.id)), media] : current.filter((candidate) => !(candidate.userId === media.userId && candidate.stream.id === media.stream.id))); },
      onLocalMedia(kind, stream) { setLocalMedia((current) => { const nextMedia = { ...current }; if (stream) nextMedia[kind] = stream; else delete nextMedia[kind]; return nextMedia; }); },
      onPing: setPing,
      onError: onToast
    });
    manager.current = next;
    setJoinedChannelId(channelId); setMuted(false); setCameraEnabled(false); setSharing(false);
    try {
      await next.start();
      void refreshAudioDevices().catch(() => undefined);
      const channel = selectedCommunity?.channels.find((candidate) => candidate.id === channelId);
      onCallStateChange({ communityName: selectedCommunity?.name ?? "Studio", channelName: channel?.name ?? "Call" });
    }
    catch (reason) { manager.current = null; setJoinedChannelId(null); onCallStateChange(null); onToast(reason instanceof Error ? reason.message : "Não foi possível entrar na call"); }
  };

  const leaveCall = () => {
    manager.current?.disconnect(); manager.current = null; setJoinedChannelId(null); setRemoteMedia([]); setLocalMedia({}); setParticipants((current) => current.filter((participant) => participant.userId !== currentUser.id)); setPing(null); setCameraEnabled(false); setSharing(false); onCallStateChange(null);
  };

  const changeMicrophone = async (deviceId: string) => {
    setSelectedAudioDevice(deviceId); localStorage.setItem("workdeck.microphone-device", deviceId);
    try { await manager.current?.setMicrophone(deviceId || undefined); }
    catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível trocar o microfone"); }
  };

  const toggleCamera = async () => {
    const enable = !cameraEnabled;
    try { await manager.current?.setCamera(enable); setCameraEnabled(enable); }
    catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível alterar a câmera"); }
  };
  const startSharing = async () => {
    setModal(null);
    try { await manager.current?.startScreenShare(streamSettings); setSharing(true); }
    catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível compartilhar a tela"); }
  };
  const stopSharing = () => { manager.current?.stopScreenShare(); setSharing(false); };

  const acceptInvite = async (invite: CommunityInvite) => {
    try { const result = await social.acceptCommunityInvite(invite.code); await refresh(result.communityId); onToast(`Você entrou em ${invite.communityName}`); }
    catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível aceitar o convite"); }
  };

  const createChannel = async (kind: "text" | "voice", name?: string) => {
    if (!selectedCommunity) return;
    if (!name) { setChannelKind(kind); setShowChannelMenu(false); return; }
    try { const channel = await social.createCommunityChannel(selectedCommunity.id, { name, kind }); await refresh(selectedCommunity.id); setSelectedChannelId(channel.id); }
    catch (reason) { onToast(reason instanceof Error ? reason.message : "Não foi possível criar o canal"); }
  };

  const voiceUsers = useMemo(() => selectedChannel ? participants.filter((participant) => participant.channelId === selectedChannel.id) : [], [participants, selectedChannel]);
  const screenStreams = remoteMedia.filter((media) => media.kind === "screen");
  const cameraStreams = remoteMedia.filter((media) => media.kind === "camera");
  const onlineMembers = selectedCommunity?.members.filter((member) => member.status !== "offline") ?? [];
  const offlineMembers = selectedCommunity?.members.filter((member) => member.status === "offline") ?? [];

  return <div className="studios-view" style={{ "--studio-channels-width": `${channelWidth}px`, "--studio-members-width": `${memberWidth}px`, "--studio-voice-chat-width": `${voiceChatWidth}px` } as React.CSSProperties} onClick={() => profileMember && setProfileMember(null)}>
    <aside className="studio-rail"><button className="studio-rail-home" title="Studios"><Radio size={21} /></button><i />{communities.map((community) => <button key={community.id} className={community.id === selectedCommunityId ? "active" : ""} style={{ "--studio-color": community.iconColor } as React.CSSProperties} title={community.name} onClick={(event) => { event.stopPropagation(); setSelectedCommunityId(community.id); setSelectedChannelId(community.channels.find((channel) => channel.kind === "text")?.id ?? community.channels[0]?.id ?? ""); }}>{initials(community.name)}</button>)}<button className="studio-rail-add" title="Criar comunidade" onClick={(event) => { event.stopPropagation(); setModal("create"); }}><Plus size={19} /></button><button className="studio-rail-join" title="Entrar com convite" onClick={(event) => { event.stopPropagation(); setModal("join"); }}><Link2 size={18} /></button></aside>

    {selectedCommunity ? <>
      <aside className="studio-channels"><header><button><strong>{selectedCommunity.name}</strong><ChevronDown size={15} /></button></header><div className="studio-channel-scroll"><section><div className="studio-channel-label"><span>CANAIS DE TEXTO</span>{selectedCommunity.role === "owner" && <button onClick={() => setShowChannelMenu(!showChannelMenu)}><Plus size={14} /></button>}</div>{selectedCommunity.channels.filter((channel) => channel.kind === "text").map((channel) => <button key={channel.id} className={selectedChannelId === channel.id ? "active" : ""} onClick={() => setSelectedChannelId(channel.id)}><Hash size={16} /><span>{channel.name}</span></button>)}</section><section><div className="studio-channel-label"><span>CANAIS DE VOZ</span>{selectedCommunity.role === "owner" && <button onClick={() => setShowChannelMenu(!showChannelMenu)}><Plus size={14} /></button>}</div>{selectedCommunity.channels.filter((channel) => channel.kind === "voice").map((channel) => <div key={channel.id} className="studio-voice-entry"><button className={selectedChannelId === channel.id ? "active" : ""} onClick={() => setSelectedChannelId(channel.id)}><Volume2 size={16} /><span>{channel.name}</span>{joinedChannelId === channel.id && <Signal size={12} />}</button>{participants.filter((participant) => participant.channelId === channel.id).map((participant) => <button className="studio-voice-user" key={participant.userId} onClick={(event) => { event.stopPropagation(); const member = selectedCommunity.members.find((candidate) => candidate.id === participant.userId); if (member) setProfileMember(member); }}><span style={{ background: participant.avatarColor, backgroundImage: participant.avatarUrl ? `url(${participant.avatarUrl})` : undefined }}>{!participant.avatarUrl && initials(participant.displayName)}</span><b>{participant.displayName}</b>{participant.muted && <MicOff size={11} />}</button>)}</div>)}</section>{showChannelMenu && <div className="studio-channel-create"><button onClick={() => void createChannel("text")}><Hash size={14} /> Canal de texto</button><button onClick={() => void createChannel("voice")}><Volume2 size={14} /> Canal de voz</button></div>}</div><footer><button onClick={() => setModal("invite")}><UserPlus size={15} /> Convidar pessoas</button></footer></aside>

      <button className="studio-resizer studio-resizer-channels" aria-label="Redimensionar canais" onPointerDown={(event) => resizeDivider("channels", event)} />
      <main className="studio-content">{incomingInvites.length > 0 && <div className="studio-incoming"><span><UserPlus size={15} /><b>{incomingInvites[0].creatorName}</b> convidou você para <b>{incomingInvites[0].communityName}</b></span><button onClick={() => void acceptInvite(incomingInvites[0])}>Aceitar</button><button onClick={() => setIncomingInvites((current) => current.slice(1))}><X size={14} /></button></div>}{selectedChannel?.kind === "text" && <ChannelMessages channel={selectedChannel} messages={messages} currentUserId={currentUser.id} transfers={transfers} onSend={sendMessage} onQueueFile={setPendingAttachment} onAcceptFile={(message) => void acceptStudioFile(message)} onSaveFile={(message) => void saveStudioFile(message)} onOpenFile={(message) => { const path = message.file && transfers[message.file.transferId]?.savedPath; if (path) void openSavedFile(path); }} onRevealFile={(message) => { const path = message.file && transfers[message.file.transferId]?.savedPath; if (path) void revealSavedFile(path); }} onZoomImage={setZoomedImage} />}{selectedChannel?.kind === "voice" && <div className="studio-voice-layout"><section className="studio-stage"><header><div><span className="live-pill"><i /> Canal de voz</span><h2>{selectedChannel.name}</h2></div><span className={`studio-ping ${ping !== null && ping < 90 ? "good" : ping !== null && ping < 180 ? "medium" : ""}`}><Signal size={14} /> {ping === null ? "Aguardando conexão" : `${ping} ms`}</span></header>{joinedChannelId !== selectedChannel.id ? <div className="studio-join-call"><span><Headphones size={35} /></span><h3>Pronto para criar junto?</h3><p>{voiceUsers.length ? `${voiceUsers.length} pessoa(s) nesta call agora.` : "Ninguém entrou ainda. Você pode abrir a sala."}</p><button className="primary-button" onClick={() => void joinCall(selectedChannel.id)}><Headphones size={16} /> Entrar na call</button></div> : <><div className={`studio-media-stage ${screenStreams.length || localMedia.screen ? "has-screen" : ""}`}>{localMedia.screen && <article className="studio-screen-card"><MediaView stream={localMedia.screen} muted /><span>Você · Tela</span><button onClick={() => void openStreamPopout(localMedia.screen!, "Sua transmissão")}><Maximize2 size={14} /> Desanexar</button></article>}{screenStreams.map((media) => { const person = voiceUsers.find((participant) => participant.userId === media.userId); return <article className="studio-screen-card" key={`${media.userId}-${media.stream.id}`}><MediaView stream={media.stream} /><span>{person?.displayName ?? "Participante"} · Ao vivo</span><button onClick={() => void openStreamPopout(media.stream, `Live de ${person?.displayName ?? "participante"}`)}><Maximize2 size={14} /> Desanexar</button></article>; })}{!screenStreams.length && !localMedia.screen && <div className="studio-call-grid">{localMedia.camera && <article className="local-camera"><MediaView stream={localMedia.camera} muted /><span>Você</span></article>}{cameraStreams.map((media) => { const person = voiceUsers.find((participant) => participant.userId === media.userId); return <article key={`${media.userId}-${media.stream.id}`}><MediaView stream={media.stream} /><span>{person?.displayName ?? "Participante"}</span></article>; })}{voiceUsers.filter((participant) => !cameraStreams.some((media) => media.userId === participant.userId) && participant.userId !== currentUser.id).map((participant) => <button key={participant.userId} className="studio-voice-placeholder" onClick={(event) => { event.stopPropagation(); const member = selectedCommunity.members.find((candidate) => candidate.id === participant.userId); if (member) setProfileMember(member); }}><span style={{ background: participant.avatarColor, backgroundImage: participant.avatarUrl ? `url(${participant.avatarUrl})` : undefined }}>{!participant.avatarUrl && initials(participant.displayName)}</span><b>{participant.displayName}</b><small>{participant.currentAppName ? `Trabalhando em ${participant.currentAppName}` : participant.muted ? "Microfone mutado" : "Na call"}</small></button>)}</div>}</div><div className="studio-call-controls"><label className="studio-mic-picker" title="Escolher microfone"><span className={muted ? "danger" : ""} onClick={() => { const next = !muted; manager.current?.setMuted(next); setMuted(next); }}>{muted ? <MicOff size={19} /> : <Mic size={19} />}</span><select aria-label="Microfone" value={selectedAudioDevice} onChange={(event) => void changeMicrophone(event.target.value)}><option value="">Microfone padrão</option>{audioDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}</select></label><button className={cameraEnabled ? "active" : ""} title={cameraEnabled ? "Desligar câmera" : "Ligar câmera"} onClick={() => void toggleCamera()}>{cameraEnabled ? <Camera size={19} /> : <CameraOff size={19} />}</button><button className={sharing ? "active" : ""} title={sharing ? "Parar transmissão" : "Compartilhar tela"} onClick={() => sharing ? stopSharing() : setModal("stream")}><MonitorUp size={19} /></button><button title="Configurações de áudio" onClick={() => setShowAudioSettings(!showAudioSettings)}><Settings2 size={19} /></button><button className="hangup" title="Sair da call" onClick={leaveCall}><LogOut size={19} /></button>{showAudioSettings && <AudioSettings value={audioSettings} onChange={setAudioSettings} onClose={() => setShowAudioSettings(false)} />}</div></>}</section><button className="studio-resizer studio-resizer-voice" aria-label="Redimensionar chat da call" onPointerDown={(event) => resizeDivider("voice", event)} /><ChannelMessages channel={selectedChannel} messages={messages} currentUserId={currentUser.id} transfers={transfers} onSend={sendMessage} onQueueFile={setPendingAttachment} onAcceptFile={(message) => void acceptStudioFile(message)} onSaveFile={(message) => void saveStudioFile(message)} onOpenFile={(message) => { const path = message.file && transfers[message.file.transferId]?.savedPath; if (path) void openSavedFile(path); }} onRevealFile={(message) => { const path = message.file && transfers[message.file.transferId]?.savedPath; if (path) void revealSavedFile(path); }} onZoomImage={setZoomedImage} /></div>}{!selectedChannel && <div className="studio-empty-state"><Hash size={35} /><h2>Escolha um canal</h2></div>}</main>

      <button className="studio-resizer studio-resizer-members" aria-label="Redimensionar membros" onPointerDown={(event) => resizeDivider("members", event)} />
      <aside className="studio-members"><header className="studio-right-tabs"><button className={rightPanel === "members" ? "active" : ""} onClick={() => setRightPanel("members")}><Users size={15} /> Membros</button><button className={rightPanel === "friends" ? "active" : ""} onClick={() => setRightPanel("friends")}><MessageCircle size={15} /> Amigos</button></header>{rightPanel === "members" ? <div className="studio-member-scroll"><span className="studio-member-group">ONLINE — {onlineMembers.length}</span>{onlineMembers.map((member) => <button key={member.id} onClick={(event) => { event.stopPropagation(); setProfileMember(member); }}><MemberAvatar member={member} small /><div><strong>{member.displayName}</strong><span>{member.currentAppName ? member.currentAppName : member.status === "away" ? "Ausente" : "Online"}</span></div>{member.role === "owner" && <ShieldCheck size={12} />}</button>)}<span className="studio-member-group">OFFLINE — {offlineMembers.length}</span>{offlineMembers.map((member) => <button className="offline" key={member.id} onClick={(event) => { event.stopPropagation(); setProfileMember(member); }}><MemberAvatar member={member} small /><div><strong>{member.displayName}</strong><span>Offline</span></div></button>)}</div> : <div className="studio-member-scroll"><span className="studio-member-group">SEUS AMIGOS — {friends.length}</span>{[...friends].sort((a, b) => Number(b.status !== "offline") - Number(a.status !== "offline")).map((friend) => <button className={friend.status === "offline" ? "offline" : ""} key={friend.id} onClick={() => onOpenDm(friend.id)}><MemberAvatar member={friend} small /><div><strong>{friend.displayName}</strong><span>{friend.currentAppName ?? (friend.status === "away" ? "Ausente" : friend.status === "offline" ? "Offline" : "Online")}</span></div>{friend.unreadCount > 0 && <i className="studio-friend-unread">{friend.unreadCount}</i>}</button>)}</div>}</aside>
    </> : <main className="studio-welcome"><span><Radio size={37} /></span><h1>Seus Studios começam aqui.</h1><p>Crie uma comunidade para conversar, trabalhar em call e compartilhar tela com sua equipe.</p><div><button className="primary-button" onClick={() => setModal("create")}><Plus size={16} /> Criar Studio</button><button className="secondary-button" onClick={() => setModal("join")}><Link2 size={16} /> Usar convite</button></div></main>}

    {remoteMedia.filter((media) => media.kind === "microphone").map((media) => <AudioView key={`${media.userId}-${media.stream.id}`} stream={media.stream} />)}
    {profileMember && <MemberPopover member={profileMember} currentUserId={currentUser.id} onClose={() => setProfileMember(null)} onOpenDm={onOpenDm} />}
    {(modal === "create" || modal === "join") && <CommunityModal mode={modal} onClose={() => setModal(null)} onCreated={(community) => { setCommunities((current) => [...current, community]); setSelectedCommunityId(community.id); setSelectedChannelId(community.channels[0]?.id ?? ""); }} onJoined={(communityId) => void refresh(communityId)} />}
    {modal === "invite" && selectedCommunity && <InviteModal community={selectedCommunity} friends={friends} onClose={() => setModal(null)} onToast={onToast} />}
    {modal === "stream" && <StreamSetup value={streamSettings} onChange={setStreamSettings} onStart={() => void startSharing()} onClose={() => setModal(null)} />}
    {channelKind && <ChannelModal kind={channelKind} onClose={() => setChannelKind(null)} onCreate={(name) => createChannel(channelKind, name)} />}
    {pendingAttachment && <div className="modal-backdrop" onMouseDown={() => setPendingAttachment(null)}><section className="modal studio-file-confirm" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">Envio P2P</span><h2>Enviar este arquivo?</h2></div><button onClick={() => setPendingAttachment(null)}><X size={18} /></button></div>{pendingPreviewUrl && <img src={pendingPreviewUrl} alt="Prévia do arquivo" />}<div className="studio-confirm-file"><Paperclip size={20} /><span><strong>{pendingAttachment.name}</strong><small>{formatFileSize(pendingAttachment.size)}</small></span></div><p className="studio-modal-copy">O arquivo não será guardado no servidor. Ele será transferido diretamente para quem aceitar recebê-lo enquanto você estiver online.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setPendingAttachment(null)}>Cancelar</button><button className="primary-button" onClick={() => void sendStudioFile()}><Send size={15} /> Enviar</button></div></section></div>}
    {zoomedImage && <div className="studio-image-lightbox" onClick={() => setZoomedImage(null)}><button><X size={22} /></button><img src={zoomedImage} alt="Imagem ampliada" /></div>}
  </div>;
}

export function StreamPopoutWindow() {
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("sessionId") ?? "";
  const title = query.get("title") ?? "Transmissão";
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("studio-popout-document");
    const channel = new BroadcastChannel(`workdeck-stream-${sessionId}`);
    const peer = new RTCPeerConnection();
    const pendingIce: RTCIceCandidateInit[] = [];
    peer.ontrack = ({ streams }) => { setConnectionError(false); setStream(streams[0]); };
    peer.onconnectionstatechange = () => { if (peer.connectionState === "failed" || peer.connectionState === "disconnected") setConnectionError(true); };
    peer.onicecandidate = ({ candidate }) => { if (candidate) channel.postMessage({ type: "candidate", candidate: candidate.toJSON() }); };
    channel.onmessage = async ({ data }) => {
      if (data?.type === "offer") { await peer.setRemoteDescription(data.description); for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate).catch(() => undefined); await peer.setLocalDescription(await peer.createAnswer()); channel.postMessage({ type: "answer", description: peer.localDescription }); }
      else if (data?.type === "candidate") { if (peer.remoteDescription) await peer.addIceCandidate(data.candidate).catch(() => undefined); else pendingIce.push(data.candidate); }
    };
    const announce = window.setInterval(() => channel.postMessage({ type: "ready" }), 500);
    channel.postMessage({ type: "ready" });
    const timeout = window.setTimeout(() => { if (!stream) setConnectionError(true); }, 12_000);
    return () => { window.clearInterval(announce); window.clearTimeout(timeout); channel.postMessage({ type: "close" }); channel.close(); peer.close(); document.documentElement.classList.remove("studio-popout-document"); };
    // The stream arrives asynchronously through WebRTC; tracking it in this dependency would restart the peer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    if ("__TAURI_INTERNALS__" in window) { const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().setAlwaysOnTop(next); }
    setAlwaysOnTop(next);
  };
  return <div className="studio-popout"><header><div><Radio size={15} /><strong>{title}</strong></div><button className={alwaysOnTop ? "active" : ""} onClick={() => void toggleAlwaysOnTop()}><Maximize2 size={14} /> {alwaysOnTop ? "Sempre visível" : "Fixar no topo"}</button></header><main>{stream ? <MediaView stream={stream} /> : <div className={connectionError ? "error" : ""}><Signal size={28} /><span>{connectionError ? "Não foi possível conectar. Feche esta janela e desanexe a live novamente." : "Conectando à transmissão…"}</span></div>}</main></div>;
}
