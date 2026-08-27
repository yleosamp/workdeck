import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Copy,
  FileUp,
  Hash,
  Headphones,
  Link2,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
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
  X
} from "lucide-react";
import { social, type ApiCommunity, type ApiFriend, type CommunityInvite, type CommunityMember, type CommunityMessage, type RealtimeEvent, type SocialUser, type VoiceParticipant } from "../lib/social";
import { openStreamPopout } from "../lib/stream-popout";
import { defaultAudioProcessing, defaultStreamSettings, VoiceCallManager, type AudioProcessingSettings, type CallMediaKind, type RemoteMedia, type StreamQuality, type StreamSettings } from "../lib/voice";

type StudiosViewProps = {
  currentUser: SocialUser;
  friends: ApiFriend[];
  pendingInviteCode: string | null;
  onInviteHandled: () => void;
  onOpenDm: (userId: string, file?: File, member?: CommunityMember) => void;
  onToast: (message: string) => void;
};

type LocalMedia = Partial<Record<CallMediaKind, MediaStream>>;

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

function ChannelMessages({ channel, messages, currentUserId, onSend }: { channel: { id: string; name: string; kind: "text" | "voice" }; messages: CommunityMessage[]; currentUserId: string; onSend: (body: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  const send = async () => { const body = text.trim(); if (!body) return; setText(""); await onSend(body); };
  return <section className={`studio-channel-chat ${channel.kind === "voice" ? "voice-channel-chat" : ""}`}><header><div>{channel.kind === "voice" ? <Volume2 size={17} /> : <Hash size={17} />}<strong>{channel.name}</strong></div>{channel.kind === "voice" && <span>Chat da call</span>}</header><div className="studio-message-scroll">{!messages.length && <div className="studio-conversation-start"><span>{channel.kind === "voice" ? <Volume2 size={25} /> : <Hash size={25} />}</span><h3>Começo de #{channel.name}</h3><p>As mensagens ficam salvas para os membros desta comunidade.</p></div>}{messages.map((message, index) => { const previous = messages[index - 1]; const grouped = previous?.senderId === message.senderId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000; return <article key={message.id} className={`studio-message ${grouped ? "grouped" : ""} ${message.senderId === currentUserId ? "mine" : ""}`}>{!grouped && <span className="studio-message-avatar" style={{ background: message.author.avatarColor, backgroundImage: message.author.avatarUrl ? `url(${message.author.avatarUrl})` : undefined }}>{!message.author.avatarUrl && initials(message.author.displayName)}</span>}<div>{!grouped && <header><strong>{message.author.displayName}</strong><time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></header>}<p>{message.body}</p></div></article>; })}<div ref={endRef} /></div><form className="studio-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><input value={text} onChange={(event) => setText(event.target.value)} placeholder={`Conversar em #${channel.name}`} /><button disabled={!text.trim()}><Send size={16} /></button></form></section>;
}

export function StudiosView({ currentUser, friends, pendingInviteCode, onInviteHandled, onOpenDm, onToast }: StudiosViewProps) {
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
  const manager = useRef<VoiceCallManager | null>(null);

  const selectedCommunity = communities.find((community) => community.id === selectedCommunityId) ?? null;
  const selectedChannel = selectedCommunity?.channels.find((channel) => channel.id === selectedChannelId) ?? null;

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

  useEffect(() => () => manager.current?.disconnect(), []);
  useEffect(() => { localStorage.setItem("workdeck.stream-settings", JSON.stringify(streamSettings)); }, [streamSettings]);
  useEffect(() => { localStorage.setItem("workdeck.audio-processing", JSON.stringify(audioSettings)); }, [audioSettings]);

  useEffect(() => {
    if (!pendingInviteCode) return;
    void social.communityInvite(pendingInviteCode).then(({ invite, alreadyMember }) => {
      if (alreadyMember) { void refresh(invite.communityId); onToast(`Você já participa de ${invite.communityName}`); }
      else if (window.confirm(`Entrar na comunidade “${invite.communityName}” de ${invite.creatorName}?`)) void social.acceptCommunityInvite(pendingInviteCode).then((result) => refresh(result.communityId)).catch((error) => onToast(error.message));
    }).catch((error) => onToast(error.message)).finally(onInviteHandled);
  }, [pendingInviteCode, onInviteHandled, onToast, refresh]);

  const sendMessage = async (body: string) => {
    if (!selectedChannel) return;
    const message = await social.sendCommunityMessage(selectedChannel.id, body);
    setMessages((current) => current.some((candidate) => candidate.id === message.id) ? current : [...current, message]);
  };

  const joinCall = async (channelId: string) => {
    manager.current?.disconnect();
    setRemoteMedia([]); setLocalMedia({}); setParticipants((current) => current.filter((participant) => participant.channelId !== joinedChannelId));
    const next = new VoiceCallManager({
      currentUserId: currentUser.id,
      channelId,
      audioProcessing: audioSettings,
      onRemoteMedia(media) { setRemoteMedia((current) => media.active ? [...current.filter((candidate) => !(candidate.userId === media.userId && candidate.stream.id === media.stream.id)), media] : current.filter((candidate) => !(candidate.userId === media.userId && candidate.stream.id === media.stream.id))); },
      onLocalMedia(kind, stream) { setLocalMedia((current) => { const nextMedia = { ...current }; if (stream) nextMedia[kind] = stream; else delete nextMedia[kind]; return nextMedia; }); },
      onPing: setPing,
      onError: onToast
    });
    manager.current = next;
    setJoinedChannelId(channelId); setMuted(false); setCameraEnabled(false); setSharing(false);
    try { await next.start(); }
    catch (reason) { manager.current = null; setJoinedChannelId(null); onToast(reason instanceof Error ? reason.message : "Não foi possível entrar na call"); }
  };

  const leaveCall = () => {
    manager.current?.disconnect(); manager.current = null; setJoinedChannelId(null); setRemoteMedia([]); setLocalMedia({}); setParticipants((current) => current.filter((participant) => participant.userId !== currentUser.id)); setPing(null); setCameraEnabled(false); setSharing(false);
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

  return <div className="studios-view" onClick={() => profileMember && setProfileMember(null)}>
    <aside className="studio-rail"><button className="studio-rail-home" title="Studios"><Radio size={21} /></button><i />{communities.map((community) => <button key={community.id} className={community.id === selectedCommunityId ? "active" : ""} style={{ "--studio-color": community.iconColor } as React.CSSProperties} title={community.name} onClick={(event) => { event.stopPropagation(); setSelectedCommunityId(community.id); setSelectedChannelId(community.channels.find((channel) => channel.kind === "text")?.id ?? community.channels[0]?.id ?? ""); }}>{initials(community.name)}</button>)}<button className="studio-rail-add" title="Criar comunidade" onClick={(event) => { event.stopPropagation(); setModal("create"); }}><Plus size={19} /></button><button className="studio-rail-join" title="Entrar com convite" onClick={(event) => { event.stopPropagation(); setModal("join"); }}><Link2 size={18} /></button></aside>

    {selectedCommunity ? <>
      <aside className="studio-channels"><header><button><strong>{selectedCommunity.name}</strong><ChevronDown size={15} /></button></header><div className="studio-channel-scroll"><section><div className="studio-channel-label"><span>CANAIS DE TEXTO</span>{selectedCommunity.role === "owner" && <button onClick={() => setShowChannelMenu(!showChannelMenu)}><Plus size={14} /></button>}</div>{selectedCommunity.channels.filter((channel) => channel.kind === "text").map((channel) => <button key={channel.id} className={selectedChannelId === channel.id ? "active" : ""} onClick={() => setSelectedChannelId(channel.id)}><Hash size={16} /><span>{channel.name}</span></button>)}</section><section><div className="studio-channel-label"><span>CANAIS DE VOZ</span>{selectedCommunity.role === "owner" && <button onClick={() => setShowChannelMenu(!showChannelMenu)}><Plus size={14} /></button>}</div>{selectedCommunity.channels.filter((channel) => channel.kind === "voice").map((channel) => <div key={channel.id} className="studio-voice-entry"><button className={selectedChannelId === channel.id ? "active" : ""} onClick={() => setSelectedChannelId(channel.id)}><Volume2 size={16} /><span>{channel.name}</span>{joinedChannelId === channel.id && <Signal size={12} />}</button>{participants.filter((participant) => participant.channelId === channel.id).map((participant) => <button className="studio-voice-user" key={participant.userId} onClick={(event) => { event.stopPropagation(); const member = selectedCommunity.members.find((candidate) => candidate.id === participant.userId); if (member) setProfileMember(member); }}><span style={{ background: participant.avatarColor, backgroundImage: participant.avatarUrl ? `url(${participant.avatarUrl})` : undefined }}>{!participant.avatarUrl && initials(participant.displayName)}</span><b>{participant.displayName}</b>{participant.muted && <MicOff size={11} />}</button>)}</div>)}</section>{showChannelMenu && <div className="studio-channel-create"><button onClick={() => void createChannel("text")}><Hash size={14} /> Canal de texto</button><button onClick={() => void createChannel("voice")}><Volume2 size={14} /> Canal de voz</button></div>}</div><footer><button onClick={() => setModal("invite")}><UserPlus size={15} /> Convidar pessoas</button></footer></aside>

      <main className="studio-content">{incomingInvites.length > 0 && <div className="studio-incoming"><span><UserPlus size={15} /><b>{incomingInvites[0].creatorName}</b> convidou você para <b>{incomingInvites[0].communityName}</b></span><button onClick={() => void acceptInvite(incomingInvites[0])}>Aceitar</button><button onClick={() => setIncomingInvites((current) => current.slice(1))}><X size={14} /></button></div>}{selectedChannel?.kind === "text" && <ChannelMessages channel={selectedChannel} messages={messages} currentUserId={currentUser.id} onSend={sendMessage} />}{selectedChannel?.kind === "voice" && <div className="studio-voice-layout"><section className="studio-stage"><header><div><span className="live-pill"><i /> Canal de voz</span><h2>{selectedChannel.name}</h2></div><span className={`studio-ping ${ping !== null && ping < 90 ? "good" : ping !== null && ping < 180 ? "medium" : ""}`}><Signal size={14} /> {ping === null ? "Aguardando conexão" : `${ping} ms`}</span></header>{joinedChannelId !== selectedChannel.id ? <div className="studio-join-call"><span><Headphones size={35} /></span><h3>Pronto para criar junto?</h3><p>{voiceUsers.length ? `${voiceUsers.length} pessoa(s) nesta call agora.` : "Ninguém entrou ainda. Você pode abrir a sala."}</p><button className="primary-button" onClick={() => void joinCall(selectedChannel.id)}><Headphones size={16} /> Entrar na call</button></div> : <><div className={`studio-media-stage ${screenStreams.length || localMedia.screen ? "has-screen" : ""}`}>{localMedia.screen && <article className="studio-screen-card"><MediaView stream={localMedia.screen} muted /><span>Você · Tela</span><button onClick={() => void openStreamPopout(localMedia.screen!, "Sua transmissão")}><Maximize2 size={14} /> Desanexar</button></article>}{screenStreams.map((media) => { const person = voiceUsers.find((participant) => participant.userId === media.userId); return <article className="studio-screen-card" key={`${media.userId}-${media.stream.id}`}><MediaView stream={media.stream} /><span>{person?.displayName ?? "Participante"} · Ao vivo</span><button onClick={() => void openStreamPopout(media.stream, `Live de ${person?.displayName ?? "participante"}`)}><Maximize2 size={14} /> Desanexar</button></article>; })}{!screenStreams.length && !localMedia.screen && <div className="studio-call-grid">{localMedia.camera && <article><MediaView stream={localMedia.camera} muted /><span>Você</span></article>}{cameraStreams.map((media) => { const person = voiceUsers.find((participant) => participant.userId === media.userId); return <article key={`${media.userId}-${media.stream.id}`}><MediaView stream={media.stream} /><span>{person?.displayName ?? "Participante"}</span></article>; })}{voiceUsers.filter((participant) => !cameraStreams.some((media) => media.userId === participant.userId) && participant.userId !== currentUser.id).map((participant) => <button key={participant.userId} className="studio-voice-placeholder" onClick={(event) => { event.stopPropagation(); const member = selectedCommunity.members.find((candidate) => candidate.id === participant.userId); if (member) setProfileMember(member); }}><span style={{ background: participant.avatarColor, backgroundImage: participant.avatarUrl ? `url(${participant.avatarUrl})` : undefined }}>{!participant.avatarUrl && initials(participant.displayName)}</span><b>{participant.displayName}</b><small>{participant.currentAppName ? `Trabalhando em ${participant.currentAppName}` : participant.muted ? "Microfone mutado" : "Na call"}</small></button>)}</div>}</div><div className="studio-call-controls"><button className={muted ? "danger" : ""} title={muted ? "Desmutar" : "Mutar"} onClick={() => { const next = !muted; manager.current?.setMuted(next); setMuted(next); }}>{muted ? <MicOff size={19} /> : <Mic size={19} />}</button><button className={cameraEnabled ? "active" : ""} title={cameraEnabled ? "Desligar câmera" : "Ligar câmera"} onClick={() => void toggleCamera()}>{cameraEnabled ? <Camera size={19} /> : <CameraOff size={19} />}</button><button className={sharing ? "active" : ""} title={sharing ? "Parar transmissão" : "Compartilhar tela"} onClick={() => sharing ? stopSharing() : setModal("stream")}><MonitorUp size={19} /></button><button title="Configurações de áudio" onClick={() => setShowAudioSettings(!showAudioSettings)}><Settings2 size={19} /></button><button className="hangup" title="Sair da call" onClick={leaveCall}><LogOut size={19} /></button>{showAudioSettings && <AudioSettings value={audioSettings} onChange={setAudioSettings} onClose={() => setShowAudioSettings(false)} />}</div></>}</section><ChannelMessages channel={selectedChannel} messages={messages} currentUserId={currentUser.id} onSend={sendMessage} /></div>}{!selectedChannel && <div className="studio-empty-state"><Hash size={35} /><h2>Escolha um canal</h2></div>}</main>

      <aside className="studio-members"><header><Users size={16} /><strong>{selectedCommunity.members.length} membros</strong></header><div className="studio-member-scroll"><span className="studio-member-group">ONLINE — {onlineMembers.length}</span>{onlineMembers.map((member) => <button key={member.id} onClick={(event) => { event.stopPropagation(); setProfileMember(member); }}><MemberAvatar member={member} small /><div><strong>{member.displayName}</strong><span>{member.currentAppName ? member.currentAppName : member.status === "away" ? "Ausente" : "Online"}</span></div>{member.role === "owner" && <ShieldCheck size={12} />}</button>)}<span className="studio-member-group">OFFLINE — {offlineMembers.length}</span>{offlineMembers.map((member) => <button className="offline" key={member.id} onClick={(event) => { event.stopPropagation(); setProfileMember(member); }}><MemberAvatar member={member} small /><div><strong>{member.displayName}</strong><span>Offline</span></div></button>)}</div></aside>
    </> : <main className="studio-welcome"><span><Radio size={37} /></span><h1>Seus Studios começam aqui.</h1><p>Crie uma comunidade para conversar, trabalhar em call e compartilhar tela com sua equipe.</p><div><button className="primary-button" onClick={() => setModal("create")}><Plus size={16} /> Criar Studio</button><button className="secondary-button" onClick={() => setModal("join")}><Link2 size={16} /> Usar convite</button></div></main>}

    {remoteMedia.filter((media) => media.kind === "microphone").map((media) => <AudioView key={`${media.userId}-${media.stream.id}`} stream={media.stream} />)}
    {profileMember && <MemberPopover member={profileMember} currentUserId={currentUser.id} onClose={() => setProfileMember(null)} onOpenDm={onOpenDm} />}
    {(modal === "create" || modal === "join") && <CommunityModal mode={modal} onClose={() => setModal(null)} onCreated={(community) => { setCommunities((current) => [...current, community]); setSelectedCommunityId(community.id); setSelectedChannelId(community.channels[0]?.id ?? ""); }} onJoined={(communityId) => void refresh(communityId)} />}
    {modal === "invite" && selectedCommunity && <InviteModal community={selectedCommunity} friends={friends} onClose={() => setModal(null)} onToast={onToast} />}
    {modal === "stream" && <StreamSetup value={streamSettings} onChange={setStreamSettings} onStart={() => void startSharing()} onClose={() => setModal(null)} />}
    {channelKind && <ChannelModal kind={channelKind} onClose={() => setChannelKind(null)} onCreate={(name) => createChannel(channelKind, name)} />}
  </div>;
}

export function StreamPopoutWindow() {
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("sessionId") ?? "";
  const title = query.get("title") ?? "Transmissão";
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  useEffect(() => {
    document.documentElement.classList.add("studio-popout-document");
    const channel = new BroadcastChannel(`workdeck-stream-${sessionId}`);
    const peer = new RTCPeerConnection();
    peer.ontrack = ({ streams }) => setStream(streams[0]);
    peer.onicecandidate = ({ candidate }) => { if (candidate) channel.postMessage({ type: "candidate", candidate: candidate.toJSON() }); };
    channel.onmessage = async ({ data }) => {
      if (data?.type === "offer") { await peer.setRemoteDescription(data.description); await peer.setLocalDescription(await peer.createAnswer()); channel.postMessage({ type: "answer", description: peer.localDescription }); }
      else if (data?.type === "candidate") await peer.addIceCandidate(data.candidate).catch(() => undefined);
    };
    channel.postMessage({ type: "ready" });
    return () => { channel.postMessage({ type: "close" }); channel.close(); peer.close(); document.documentElement.classList.remove("studio-popout-document"); };
  }, [sessionId]);
  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    if ("__TAURI_INTERNALS__" in window) { const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().setAlwaysOnTop(next); }
    setAlwaysOnTop(next);
  };
  return <div className="studio-popout"><header><div><Radio size={15} /><strong>{title}</strong></div><button className={alwaysOnTop ? "active" : ""} onClick={() => void toggleAlwaysOnTop()}><Maximize2 size={14} /> {alwaysOnTop ? "Sempre visível" : "Fixar no topo"}</button></header><main>{stream ? <MediaView stream={stream} /> : <div><Signal size={28} /><span>Conectando à transmissão…</span></div>}</main></div>;
}
