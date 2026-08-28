import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  ArrowLeft,
  Bell,
  BellRing,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Flame,
  FolderOpen,
  Home,
  Headphones,
  Library,
  Link2,
  ImagePlus,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
  X,
  ZoomIn
} from "lucide-react";
import { AppLogo } from "./components/AppLogo";
import { AuthView } from "./components/AuthView";
import { FriendManager } from "./components/FriendManager";
import { Heatmap } from "./components/Heatmap";
import { SoftwareIcon } from "./components/SoftwareIcon";
import { StreamPopoutWindow, StudiosView } from "./components/StudiosView";
import { mockApps, mockHeatmap } from "./data/mockData";
import { addTrackedApp, getActivitySnapshot } from "./lib/activity";
import { formatDuration, formatFileSize, percentChange } from "./lib/format";
import { PeerFileTransport, previewKindForFile, runP2PSelfTest, type SignalPayload } from "./lib/p2p";
import { notifySoftwareStarted } from "./lib/notifications";
import { openSavedFile, revealSavedFile, saveReceivedFile } from "./lib/save-file";
import { defaultAudioProcessing, defaultStreamSettings, type AudioProcessingSettings, type StreamQuality, type StreamSettings } from "./lib/voice";
import { social, type ApiFriend, type ApiFriendRequest, type ApiLeaderboard, type ApiMessage, type ApiProfile, type CommunityMember, type LeaderboardPeriod, type SocialUser } from "./lib/social";
import type { AppActivityDay, Friend, HeatmapDay, Message, TrackedApp, View } from "./types";

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "library", label: "Software", icon: Library },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "studios", label: "Studios", icon: Radio },
  { id: "chat", label: "Messages", icon: MessageCircle }
];

function Avatar({ friend, size = "md" }: { friend: Friend; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`avatar avatar-${size}`} style={{ background: friend.avatarColor, backgroundImage: friend.avatarUrl ? `url(${friend.avatarUrl})` : undefined }}>
      {!friend.avatarUrl && friend.avatar}
      <i className={`presence-dot presence-${friend.status}`} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: typeof Clock3; label: string; value: string; accent?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-icon" style={accent ? { color: accent, background: `${accent}18` } : undefined}><Icon size={18} /></span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="section-title">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
      {action}
    </div>
  );
}

function HomeView({ apps, heatmap, friends, userName, onViewChange }: { apps: TrackedApp[]; heatmap: HeatmapDay[]; friends: Friend[]; userName: string; onViewChange: (view: View) => void }) {
  const now = new Date();
  const currentDateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now);
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const running = apps.find((app) => app.status === "running");
  // Focused time is the union of all running-app intervals. Per-app cards keep
  // their own full counters, but this headline must never double overlapping apps.
  const today = heatmap.find((day) => day.date === localDateKey())?.seconds ?? heatmap.at(-1)?.seconds ?? 0;
  const total = heatmap.reduce((sum, day) => sum + day.seconds, 0);
  const activeDays = heatmap.slice(-30).filter((day) => day.seconds > 0).length;
  const priorWeek = heatmap.slice(-14, -7).reduce((sum, day) => sum + day.seconds, 0);
  const thisWeek = heatmap.slice(-7).reduce((sum, day) => sum + day.seconds, 0);

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">{currentDateLabel}</span>
          <h1>{greeting}, {userName.split(/\s+/)[0]}.</h1>
          <p>Your creative momentum is building. Keep the streak alive.</p>
        </div>
        <div className="hero-status">
          <span className="live-pill"><i /> Live tracking</span>
          <span>Next sync in real time</span>
        </div>
      </section>

      {running ? (
        <section className="now-card" style={{ "--active-color": running.color, "--active-glow": running.glow } as React.CSSProperties}>
          <div className="now-light" />
          <div className="now-main">
            <SoftwareIcon app={running} size="lg" />
            <div className="now-copy">
              <span className="now-label"><i /> Working now</span>
              <h2>{running.name}</h2>
              <p>{running.category} · {formatDuration(running.todaySeconds, true)} tracked today</p>
            </div>
          </div>
          <div className="session-time"><strong>{formatDuration(running.todaySeconds, true)}</strong><span>today</span></div>
          <div className="now-people">
            <div className="avatar-stack">{friends.slice(0, 3).map((friend) => <Avatar key={friend.id} friend={friend} size="sm" />)}</div>
            <span>{friends.length} friend{friends.length === 1 ? "" : "s"} can see this</span>
          </div>
        </section>
      ) : (
        <section className="now-card empty-now"><div><span className="now-label">Ready when you are</span><h2>No creative app is open</h2><p>Workdeck will start counting automatically.</p></div></section>
      )}

      <section className="stats-grid">
        <Stat icon={Clock3} label="focused today" value={formatDuration(today, true)} accent="#78e6a4" />
        <Stat icon={Flame} label="day streak" value={`${Math.min(activeDays, 12)} days`} accent="#ffb661" />
        <Stat icon={Sparkles} label="focused · 12 months" value={`${Math.floor(total / 3600).toLocaleString()}h`} accent="#a998ff" />
        <Stat icon={Activity} label="vs last week" value={`${percentChange(thisWeek, priorWeek) >= 0 ? "+" : ""}${percentChange(thisWeek, priorWeek)}%`} accent="#79c7ff" />
      </section>

      <section className="panel heat-panel">
        <SectionTitle
          eyebrow="Your rhythm"
          title="Creative activity"
          action={<button className="text-button" onClick={() => onViewChange("activity")}>Full year <ChevronRight size={15} /></button>}
        />
        <Heatmap days={heatmap} compact />
      </section>

      <section className="recent-section">
        <SectionTitle
          eyebrow="Your toolkit"
          title="Recently used"
          action={<button className="text-button" onClick={() => onViewChange("library")}>View all <ChevronRight size={15} /></button>}
        />
        <div className="app-row">
          {apps.slice(0, 4).map((app) => (
            <button className="app-card" key={app.id} onClick={() => onViewChange("library")}>
              <div className="app-card-top"><SoftwareIcon app={app} /><span className={app.status === "running" ? "running-badge" : "more-button"}>{app.status === "running" ? "Running" : <MoreHorizontal size={18} />}</span></div>
              <div><h3>{app.name}</h3><p>{app.category}</p></div>
              <div className="app-card-stats"><strong>{formatDuration(app.totalSeconds, true)}</strong><span>Total time</span></div>
              <div className="app-last"><Clock3 size={13} /> {app.lastOpened}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function LibraryView({ apps, onAdd }: { apps: TrackedApp[]; onAdd: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = apps.filter((app) => `${app.name} ${app.category}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page">
      <div className="page-heading">
        <div><span className="eyebrow">Tracked locally</span><h1>Your software</h1><p>Every hour across your creative toolkit, in one place.</p></div>
        <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add software</button>
      </div>
      <div className="library-toolbar">
        <label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter your software" /></label>
        <span>{filtered.length} apps</span>
      </div>
      <div className="library-grid">
        {filtered.map((app) => (
          <article className="library-card" key={app.id}>
            <div className="library-art" style={{ "--app-color": app.color, "--app-glow": app.glow } as React.CSSProperties}>
              <SoftwareIcon app={app} size="lg" />
              {app.status === "running" && <span className="live-pill"><i /> Running</span>}
            </div>
            <div className="library-copy">
              <div><h3>{app.name}</h3><p>{app.category}</p></div>
              <button className="icon-button" aria-label={`More options for ${app.name}`}><MoreHorizontal size={18} /></button>
            </div>
            <div className="library-metrics">
              <div><strong>{formatDuration(app.totalSeconds, true)}</strong><span>Total</span></div>
              <div><strong>{formatDuration(app.todaySeconds, true)}</strong><span>Today</span></div>
            </div>
            <div className="library-footer"><Clock3 size={14} /><span>{app.lastOpened}</span></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ActivityView({ apps, heatmap, appDaily, onExport }: { apps: TrackedApp[]; heatmap: HeatmapDay[]; appDaily: AppActivityDay[]; onExport: () => void }) {
  const [selectedAppId, setSelectedAppId] = useState("all");
  const visibleHeatmap = useMemo(() => {
    if (selectedAppId === "all") return heatmap;
    const secondsByDate = new Map(appDaily.filter((day) => day.appId === selectedAppId).map((day) => [day.date, day.seconds]));
    return heatmap.map((day) => ({ date: day.date, seconds: secondsByDate.get(day.date) ?? 0 }));
  }, [appDaily, heatmap, selectedAppId]);
  const weekly = useMemo(() => visibleHeatmap.slice(-7), [visibleHeatmap]);
  const weekMax = Math.max(...weekly.map((day) => day.seconds), 1);
  const focusedTotal = visibleHeatmap.reduce((sum, day) => sum + day.seconds, 0);
  const selectedApp = apps.find((app) => app.id === selectedAppId);
  return (
    <div className="page">
      <div className="page-heading"><div><span className="eyebrow">365-day history</span><h1>Activity</h1><p>See when and where your best work happens.</p></div><div className="activity-actions"><label><span>Software</span><select value={selectedAppId} onChange={(event) => setSelectedAppId(event.target.value)}><option value="all">All software</option>{apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label><button className="secondary-button" onClick={onExport}><Download size={16} /> Export data</button></div></div>
      <section className="activity-split">
        <div className="panel yearly-panel">
          <SectionTitle title={selectedApp ? `${selectedApp.name} · daily history` : "A year of making"} action={<span className="muted-label">{visibleHeatmap.filter((day) => day.seconds > 0).length} active days</span>} />
          <Heatmap days={visibleHeatmap} />
        </div>
        <div className="panel weekly-panel">
          <SectionTitle title="This week" action={<span className="trend-chip">+18%</span>} />
          <div className="bar-chart">
            {weekly.map((day, index) => (
              <div className="bar-column" key={day.date}>
                <span className="bar-value">{day.seconds ? formatDuration(day.seconds, true) : ""}</span>
                <div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(4, (day.seconds / weekMax) * 100)}%` }} /></div>
                <span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date(`${day.date}T12:00:00`)).slice(0, 2)}</span>
                {index === 6 && <i className="today-marker" />}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="panel breakdown-panel">
        <SectionTitle title="Time by software" action={<span className="muted-label">{Math.floor((selectedApp?.totalSeconds ?? focusedTotal) / 3600).toLocaleString()} {selectedApp ? "app hours" : "focused hours"}</span>} />
        <div className="breakdown-list">
          {[...apps].sort((a, b) => b.totalSeconds - a.totalSeconds).map((app) => (
            <div className="breakdown-row" key={app.id}>
              <SoftwareIcon app={app} size="sm" />
              <div className="breakdown-name"><strong>{app.name}</strong><span>{app.category}</span></div>
              <div className="progress-track"><i style={{ width: `${(app.totalSeconds / Math.max(...apps.map((item) => item.totalSeconds))) * 100}%`, background: app.color }} /></div>
              <strong className="breakdown-time">{formatDuration(app.totalSeconds, true)}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const leaderboardPeriods: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: "day", label: "Hoje" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mês" },
  { id: "year", label: "Ano" }
];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function LeaderboardView({ onOpenChat }: { onOpenChat: (userId: string) => void }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [ranking, setRanking] = useState<ApiLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setRanking(await social.leaderboard(period, localDateKey()));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o ranking");
    } finally { if (!quiet) setLoading(false); }
  }, [period]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const leader = ranking?.entries[0];
  const ownEntry = ranking?.entries.find((entry) => entry.isCurrentUser);
  return (
    <div className="page leaderboard-page">
      <div className="page-heading leaderboard-heading">
        <div><span className="eyebrow">Competição entre amigos</span><h1>Leaderboard</h1><p>Quem acumulou mais horas de trabalho no período.</p></div>
        <button className="secondary-button leaderboard-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "is-spinning" : ""} /> Atualizar</button>
      </div>
      <div className="leaderboard-tabs" role="tablist" aria-label="Período do ranking">
        {leaderboardPeriods.map((item) => <button role="tab" aria-selected={period === item.id} className={period === item.id ? "active" : ""} key={item.id} onClick={() => setPeriod(item.id)}>{item.label}</button>)}
      </div>
      <section className="leaderboard-summary">
        <article><span>Líder do período</span><strong>{leader?.displayName ?? "—"}</strong><small>{leader ? formatDuration(leader.seconds, true) : "Sem atividade"}</small></article>
        <article><span>Sua posição</span><strong>{ownEntry ? `#${ownEntry.rank}` : "—"}</strong><small>{ownEntry ? formatDuration(ownEntry.seconds, true) : "Sem atividade"}</small></article>
        <article><span>Participantes</span><strong>{ranking?.entries.length ?? 0}</strong><small>Você + amigos</small></article>
      </section>
      <section className="panel leaderboard-panel">
        <div className="leaderboard-panel-title"><div><Trophy size={19} /><div><strong>Ranking do período</strong><span>{ranking ? `${ranking.startDate.split("-").reverse().join("/")} até ${ranking.endDate.split("-").reverse().join("/")}` : "Carregando período…"}</span></div></div><small>Atualização automática a cada minuto</small></div>
        {error && <div className="leaderboard-error">{error}</div>}
        {!error && loading && !ranking && <div className="leaderboard-empty">Calculando as horas do seu grupo…</div>}
        {!error && ranking && <div className="leaderboard-list">
          {ranking.entries.map((entry) => {
            const initials = entry.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
            const maxSeconds = Math.max(ranking.entries[0]?.seconds ?? 0, 1);
            return <button key={entry.id} className={`leaderboard-row rank-${entry.rank} ${entry.isCurrentUser ? "is-you" : ""}`} onClick={() => !entry.isCurrentUser && onOpenChat(entry.id)} disabled={entry.isCurrentUser}>
              <span className="leaderboard-position">{entry.rank <= 3 ? <Trophy size={17} /> : `#${entry.rank}`}</span>
              <span className="leaderboard-avatar" style={{ backgroundColor: entry.avatarColor, backgroundImage: entry.avatarUrl ? `url(${entry.avatarUrl})` : undefined }}>{!entry.avatarUrl && initials}</span>
              <span className="leaderboard-person"><strong>{entry.displayName}{entry.isCurrentUser && <i>Você</i>}</strong><small>@{entry.handle}</small></span>
              <span className="leaderboard-progress"><i style={{ width: `${Math.max(entry.seconds ? 3 : 0, (entry.seconds / maxSeconds) * 100)}%` }} /></span>
              <span className="leaderboard-time"><strong>{formatDuration(entry.seconds, true)}</strong><small>trabalhados</small></span>
            </button>;
          })}
        </div>}
      </section>
    </div>
  );
}

function mapFriend(friend: ApiFriend): Friend {
  const initials = friend.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return {
    id: friend.id,
    name: friend.displayName,
    handle: `@${friend.handle}`,
    avatar: initials,
    avatarColor: friend.avatarColor,
    avatarUrl: friend.avatarUrl,
    status: friend.status,
    currentApp: friend.currentAppName ?? undefined,
    currentAppColor: friend.currentAppName ? "#72e3a2" : undefined,
    currentActivity: friend.currentAppName ? "Working now" : undefined,
    lastSeen: friend.lastSeenAt ? `Last seen ${new Date(friend.lastSeenAt).toLocaleString()}` : "Offline",
    isFriend: true
  };
}

function mapApiMessage(message: ApiMessage, currentUserId: string): Message {
  return {
    id: message.id,
    authorId: message.senderId,
    text: message.text ?? undefined,
    sentAt: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt)),
    file: message.file ? {
      transferId: message.file.transferId,
      name: message.file.name,
      size: message.file.size,
      mime: message.file.mime,
      progress: 0,
      state: "offered",
      direction: message.senderId === currentUserId ? "outgoing" : "incoming"
    } : undefined
  };
}

function FileCard({ file, onAccept, onSave, onOpenImage, onOpenSaved, onRevealSaved }: {
  file: NonNullable<Message["file"]>;
  onAccept?: () => void;
  onSave?: () => void;
  onOpenImage?: () => void;
  onOpenSaved?: () => void;
  onRevealSaved?: () => void;
}) {
  return (
    <div className={`file-card ${file.previewKind ? "file-card-previewable" : ""}`}>
      {file.previewKind === "image" && file.previewUrl && <button type="button" className="file-image-preview" onClick={onOpenImage} title="Ampliar imagem"><img src={file.previewUrl} alt={`Preview de ${file.name}`} /><span><ZoomIn size={16} /> Clique para ampliar</span></button>}
      {file.previewKind === "audio" && file.previewUrl && <div className="file-audio-preview"><audio controls preload="metadata" src={file.previewUrl}>Seu computador não conseguiu reproduzir este formato.</audio></div>}
      <div className="file-card-row">
        <div className="file-icon"><FolderOpen size={22} /></div>
        <div className="file-info"><strong>{file.name}</strong><span>{formatFileSize(file.size)} · P2P, sem upload</span>{file.state === "transferring" && <div className="file-progress"><i style={{ width: `${file.progress}%` }} /></div>}</div>
        {file.state === "offered" && file.direction === "incoming" && onAccept
          ? <button type="button" className="file-accept" onClick={onAccept}><Download size={15} /> Receber</button>
          : onSave && file.receivedBlob && !file.saved
            ? <button type="button" className="file-accept" onClick={onSave} disabled={file.saving}><Download size={15} /> {file.saving ? "Salvando…" : "Salvar"}</button>
            : <span className={`file-state file-state-${file.state}`}>{file.state === "complete" ? <Check size={17} /> : file.state === "offered" ? <Clock3 size={15} /> : `${file.progress}%`}</span>}
      </div>
      {file.savedPath && <div className="file-saved-actions"><button type="button" onClick={onOpenSaved}><ExternalLink size={14} /> Abrir</button><button type="button" onClick={onRevealSaved}><FolderOpen size={14} /> Abrir na pasta</button></div>}
    </div>
  );
}

function ChatView({ friends, currentUserId, initialFriendId, initialAttachment, onInitialAttachmentConsumed, onFriendsChanged, onConversationRead, onOpenProfile }: { friends: Friend[]; currentUserId: string; initialFriendId?: string; initialAttachment?: File | null; onInitialAttachmentConsumed?: () => void; onFriendsChanged: () => Promise<void>; onConversationRead: (userId: string) => void; onOpenProfile: (friend: Friend) => void }) {
  const [selectedId, setSelectedId] = useState(initialFriendId ?? friends[0]?.id ?? "");
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [typing, setTyping] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showAttachmentActions, setShowAttachmentActions] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string>();
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [zoomedImage, setZoomedImage] = useState<{ url: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const transports = useRef(new Map<string, PeerFileTransport>());
  const queuedSignals = useRef(new Map<string, SignalPayload[]>());
  const pendingOutgoing = useRef(new Map<string, { file: File; messageId: string; targetUserId: string }>());
  const previewUrls = useRef(new Set<string>());
  const friend = friends.find((item) => item.id === selectedId) ?? friends[0];
  const thread = messages[selectedId] ?? [];

  useEffect(() => {
    if (!friends.some((item) => item.id === selectedId)) setSelectedId(friends[0]?.id ?? "");
  }, [friends, selectedId]);
  useEffect(() => {
    if (initialFriendId && friends.some((item) => item.id === initialFriendId)) setSelectedId(initialFriendId);
  }, [initialFriendId, friends]);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    for (const transport of transports.current.values()) transport.close();
  }, []);

  useEffect(() => {
    if (!pendingAttachment || previewKindForFile(pendingAttachment.name, pendingAttachment.type) === undefined) {
      setPendingPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(pendingAttachment);
    setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAttachment]);

  useEffect(() => {
    if (!cameraOpen) return;
    let active = true;
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("A câmera não está disponível neste computador.");
      return;
    }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).then((stream) => {
      if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
      cameraStream.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
    }).catch(() => setCameraError("Não foi possível acessar a câmera. Confira a permissão do sistema."));
    return () => {
      active = false;
      cameraStream.current?.getTracks().forEach((track) => track.stop());
      cameraStream.current = null;
    };
  }, [cameraOpen]);

  useEffect(() => {
    if (!selectedId) return;
    social.messages(selectedId).then(async (history) => {
      setMessages((current) => ({ ...current, [selectedId]: history.map((message) => mapApiMessage(message, currentUserId)) }));
      const unread = history.filter((message) => message.recipientId === currentUserId && !message.readAt);
      if (unread.length) {
        onConversationRead(selectedId);
        await Promise.all(unread.map((message) => social.markRead(message.id)));
        await onFriendsChanged();
      }
    }).catch((reason) => setError(reason.message));
  }, [selectedId, currentUserId, onFriendsChanged, onConversationRead]);

  useEffect(() => social.subscribe((event) => {
    if (event.type === "message.created") {
      const otherId = event.message.senderId === currentUserId ? event.message.recipientId : event.message.senderId;
      setMessages((current) => {
        const existing = current[otherId] ?? [];
        if (existing.some((message) => message.id === event.message.id)) return current;
        return { ...current, [otherId]: [...existing, mapApiMessage(event.message, currentUserId)] };
      });
      if (event.message.recipientId === currentUserId && otherId === selectedId) {
        onConversationRead(otherId);
        void social.markRead(event.message.id).then(onFriendsChanged);
      }
    }
    if (event.type === "chat.typing" && event.userId === selectedId) setTyping(event.isTyping);
    if (event.type === "webrtc.ready") {
      const pending = pendingOutgoing.current.get(event.transferId);
      if (pending && pending.targetUserId === event.userId) {
        void (async () => {
          try {
            const { iceServers } = await social.rtcConfig().catch(() => ({ iceServers: undefined }));
            const transport = new PeerFileTransport((signal) => social.sendRealtime({ type: "webrtc.signal", targetUserId: pending.targetUserId, transferId: event.transferId, signal }), { iceServers });
            transports.current.set(event.transferId, transport);
            await transport.createOffer();
            updateFile(pending.messageId, { state: "transferring", progress: 1 }, pending.targetUserId);
            await transport.send(pending.file, ({ transferred, total }) => updateFile(pending.messageId, { state: transferred >= total ? "complete" : "transferring", progress: Math.round((transferred / total) * 100) }, pending.targetUserId));
            pendingOutgoing.current.delete(event.transferId);
          } catch { setError("A conexão P2P falhou"); }
        })();
      }
    }
    if (event.type === "webrtc.signal") {
      const transport = transports.current.get(event.transferId);
      if (transport) void transport.acceptSignal(event.signal as SignalPayload).catch(() => setError("A conexão P2P falhou"));
      else queuedSignals.current.set(event.transferId, [...(queuedSignals.current.get(event.transferId) ?? []), event.signal as SignalPayload]);
    }
  }), [currentUserId, selectedId, onConversationRead, onFriendsChanged]);

  const updateFile = (messageId: string, update: Partial<NonNullable<Message["file"]>>, conversationId = selectedId) => {
    setMessages((current) => ({ ...current, [conversationId]: (current[conversationId] ?? []).map((item) => item.id === messageId && item.file ? { ...item, file: { ...item.file, ...update } } : item) }));
  };

  const sendText = async () => {
    const text = draft.trim();
    if (!text || !selectedId) return;
    setDraft("");
    try {
      const sent = await social.sendMessage(selectedId, { text });
      setMessages((current) => ({ ...current, [selectedId]: [...(current[selectedId] ?? []), mapApiMessage(sent, currentUserId)] }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar"); }
  };

  const sendFile = async (file: File) => {
    if (!selectedId) return;
    const transferId = crypto.randomUUID();
    try {
      const sent = await social.sendMessage(selectedId, { file: { name: file.name, size: file.size, mime: file.type || "application/octet-stream", transferId } });
      const mapped = mapApiMessage(sent, currentUserId);
      const previewKind = previewKindForFile(file.name, file.type);
      if (mapped.file && previewKind) {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        mapped.file = { ...mapped.file, previewKind, previewUrl };
      }
      setMessages((current) => ({ ...current, [selectedId]: [...(current[selectedId] ?? []), mapped] }));
      pendingOutgoing.current.set(transferId, { file, messageId: sent.id, targetUserId: selectedId });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A transferência falhou"); }
  };

  const queueAttachment = (file: File) => {
    if (file.size > 20 * 1024 * 1024 * 1024) {
      setError("O arquivo excede o limite de 20 GB");
      return;
    }
    setShowAttachmentActions(false);
    setPendingAttachment(file);
  };

  useEffect(() => {
    if (!initialAttachment) return;
    queueAttachment(initialAttachment);
    onInitialAttachmentConsumed?.();
  }, [initialAttachment]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmAttachment = async () => {
    if (!pendingAttachment || sendingAttachment) return;
    const file = pendingAttachment;
    setSendingAttachment(true);
    try {
      await sendFile(file);
      setPendingAttachment(null);
    } finally { setSendingAttachment(false); }
  };

  const pasteAttachment = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const blob = imageItem?.getAsFile();
    if (!blob) return;
    event.preventDefault();
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    queueAttachment(new File([blob], `captura-${stamp}.${extension}`, { type: blob.type, lastModified: Date.now() }));
  };

  const takeCameraPhoto = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError("A câmera ainda está iniciando. Tente novamente em um instante.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .92));
    if (!blob) { setCameraError("Não foi possível capturar a foto."); return; }
    setCameraOpen(false);
    queueAttachment(new File([blob], `foto-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
  };

  const acceptFile = async (message: Message) => {
    if (!message.file || !friend) return;
    const conversationId = friend.id;
    const transferId = message.file.transferId;
    if (!transferId) return;
    const { iceServers } = await social.rtcConfig().catch(() => ({ iceServers: undefined }));
    const transport = new PeerFileTransport(
      (signal) => social.sendRealtime({ type: "webrtc.signal", targetUserId: friend.id, transferId, signal }),
      {
        onReceiveProgress: ({ transferred, total }) => updateFile(message.id, { state: "transferring", progress: Math.round((transferred / total) * 100) }, conversationId),
        onIncomingFile: async ({ name, mime, blob }) => {
          try {
            const previewKind = previewKindForFile(name, mime);
            const previewUrl = previewKind ? URL.createObjectURL(blob) : undefined;
            if (previewUrl) previewUrls.current.add(previewUrl);
            updateFile(message.id, { state: "complete", progress: 100, previewKind, previewUrl, receivedBlob: blob, saved: false, saving: true }, conversationId);
            const saved = await saveReceivedFile(name, blob);
            updateFile(message.id, { saved: saved.saved, savedPath: saved.path, saving: false }, conversationId);
          } catch (reason) {
            updateFile(message.id, { state: "failed", progress: 0, saving: false }, conversationId);
            setError(reason instanceof Error ? reason.message : "Não foi possível salvar o arquivo");
          } finally { transport.close(); }
        },
        iceServers
      }
    );
    transports.current.set(transferId, transport);
    updateFile(message.id, { state: "transferring", progress: 0 }, conversationId);
    for (const signal of queuedSignals.current.get(transferId) ?? []) await transport.acceptSignal(signal);
    queuedSignals.current.delete(transferId);
    social.sendRealtime({ type: "webrtc.ready", targetUserId: friend.id, transferId });
  };

  const saveFileAgain = async (message: Message) => {
    if (!message.file?.receivedBlob || !friend) return;
    const conversationId = friend.id;
    updateFile(message.id, { saving: true }, conversationId);
    try {
      const saved = await saveReceivedFile(message.file.name, message.file.receivedBlob);
      updateFile(message.id, { saved: saved.saved, savedPath: saved.path, saving: false }, conversationId);
    } catch (reason) { updateFile(message.id, { saving: false }, conversationId); setError(reason instanceof Error ? reason.message : "Não foi possível salvar o arquivo"); }
  };

  const runSavedFileAction = async (action: "open" | "reveal", path?: string) => {
    if (!path) return;
    try { await (action === "open" ? openSavedFile(path) : revealSavedFile(path)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível abrir o arquivo"); }
  };

  const removeFriend = async () => {
    if (!friend || !window.confirm(`Remove ${friend.name} from your friends?`)) return;
    await social.removeFriend(friend.id);
    setShowActions(false);
    await onFriendsChanged();
  };

  const blockFriend = async () => {
    if (!friend || !window.confirm(`Block ${friend.name}? They will be removed from your friends.`)) return;
    await social.blockUser(friend.id);
    setShowActions(false);
    await onFriendsChanged();
  };

  if (!friend) return <div className="chat-empty"><MessageCircle size={30} /><h2>Nenhum amigo ainda</h2><p>Adicione alguém para começar uma conversa.</p></div>;

  return <>
    <div className="chat-layout">
      <aside className="conversation-list">
        <div className="conversation-heading"><div><span className="eyebrow">Direct messages</span><h2>Messages</h2></div><button className="icon-button"><Plus size={18} /></button></div>
        <label className="inline-search"><Search size={15} /><input placeholder="Search people" /></label>
        <div className="conversation-scroll">
          {friends.map((item) => (
            <button key={item.id} className={`conversation-item ${item.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}>
              <Avatar friend={item} />
              <div><strong>{item.name}</strong><span>{item.currentApp ? `${item.currentApp} · ${item.currentActivity?.split(" · ")[1]}` : item.lastSeen}</span></div>
              {item.mutualFriends ? <i className="unread-dot">{item.mutualFriends}</i> : null}
            </button>
          ))}
        </div>
      </aside>
      <section className="chat-panel">
        <header className="chat-header">
          <div className="chat-person"><Avatar friend={friend} /><div><strong>{friend.name}</strong><span>{friend.status === "online" ? "Online" : friend.status}</span></div></div>
          <div className="chat-actions"><button className="secondary-button" onClick={() => onOpenProfile(friend)}><UserPlus size={15} /> Profile</button><button className="icon-button" onClick={() => setShowActions(!showActions)}><MoreHorizontal size={19} /></button>{showActions && <div className="chat-action-menu">{friend.isFriend !== false && <button onClick={() => void removeFriend()}>Remove friend</button>}<button className="danger" onClick={() => void blockFriend()}>Block user</button></div>}</div>
        </header>
        {friend.currentApp && <div className="friend-activity"><span className="app-mini-dot" style={{ background: friend.currentAppColor }} /><div><span>Currently working in</span><strong>{friend.currentApp}</strong></div><span>{friend.currentActivity}</span></div>}
        <div className="messages">
          <div className="conversation-start"><Avatar friend={friend} size="lg" /><h3>{friend.name}</h3><span>{friend.handle} · {friend.isFriend === false ? "Membro de Studio" : "Workdeck friend"}</span></div>
          {thread.map((message) => (
            <div className={`message ${message.authorId === currentUserId ? "message-mine" : ""}`} key={message.id}>
              {message.authorId !== currentUserId && <Avatar friend={friend} size="sm" />}
              <div className="message-content">{message.text && <p>{message.text}</p>}{message.file && <FileCard file={message.file} onAccept={message.authorId !== currentUserId ? () => void acceptFile(message) : undefined} onSave={message.file.receivedBlob ? () => void saveFileAgain(message) : undefined} onOpenImage={message.file.previewUrl ? () => setZoomedImage({ url: message.file!.previewUrl!, name: message.file!.name }) : undefined} onOpenSaved={() => void runSavedFileAction("open", message.file?.savedPath)} onRevealSaved={() => void runSavedFileAction("reveal", message.file?.savedPath)} />}<span>{message.sentAt}</span></div>
            </div>
          ))}
          {typing && <div className="typing-indicator">{friend.name} is typing…</div>}
          {error && <div className="chat-error">{error}</div>}
        </div>
        <div className="composer">
          <div className="composer-attachment">
            <input ref={fileInputRef} aria-label="Escolher arquivo para enviar" type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) queueAttachment(file); event.target.value = ""; }} />
            <button className="attach-button" onClick={() => setShowAttachmentActions((current) => !current)} title="Enviar por P2P"><Paperclip size={19} /></button>
            {showAttachmentActions && <div className="attachment-menu"><button onClick={() => fileInputRef.current?.click()}><FileUp size={15} /> Escolher arquivo</button><button onClick={() => { setShowAttachmentActions(false); setCameraOpen(true); }}><Camera size={15} /> Tirar foto</button></div>}
          </div>
          <input value={draft} onPaste={pasteAttachment} onChange={(event) => { setDraft(event.target.value); try { social.sendRealtime({ type: "chat.typing", targetUserId: friend.id, isTyping: Boolean(event.target.value) }); } catch { /* reconnecting */ } }} onKeyDown={(event) => event.key === "Enter" && void sendText()} placeholder={`Mensagem para ${friend.name} · cole imagens com Ctrl+V`} />
          <span className="p2p-label"><ShieldCheck size={13} /> P2P</span>
          <button className="send-button" onClick={() => void sendText()}><Send size={17} /></button>
        </div>
      </section>
    </div>
    {pendingAttachment && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !sendingAttachment && setPendingAttachment(null)}><section className="modal attachment-confirm-modal"><button className="icon-button modal-close" onClick={() => setPendingAttachment(null)} disabled={sendingAttachment}><X size={17} /></button><span className="modal-icon"><Paperclip size={20} /></span><h2>Enviar este arquivo?</h2><p>Confirme antes de iniciar a transferência P2P para {friend.name}.</p>{previewKindForFile(pendingAttachment.name, pendingAttachment.type) === "image" && pendingPreviewUrl && <img className="attachment-confirm-image" src={pendingPreviewUrl} alt="Imagem que será enviada" />}{previewKindForFile(pendingAttachment.name, pendingAttachment.type) === "audio" && pendingPreviewUrl && <audio className="attachment-confirm-audio" controls src={pendingPreviewUrl} />}<div className="attachment-confirm-file"><FolderOpen size={20} /><div><strong>{pendingAttachment.name}</strong><span>{formatFileSize(pendingAttachment.size)} · não será enviado ao servidor</span></div></div><div className="attachment-confirm-actions"><button className="secondary-button" onClick={() => setPendingAttachment(null)} disabled={sendingAttachment}>Cancelar</button><button className="primary-button" onClick={() => void confirmAttachment()} disabled={sendingAttachment}><Send size={15} /> {sendingAttachment ? "Preparando…" : "Enviar"}</button></div></section></div>}
    {cameraOpen && <div className="modal-backdrop"><section className="modal camera-modal"><button className="icon-button modal-close" onClick={() => setCameraOpen(false)}><X size={17} /></button><span className="modal-icon"><Camera size={20} /></span><h2>Tirar foto</h2><p>A foto também será enviada diretamente por P2P, sem armazenamento na VPS.</p><div className="camera-frame"><video ref={videoRef} autoPlay playsInline muted />{cameraError && <span>{cameraError}</span>}</div><button className="primary-button modal-save" onClick={() => void takeCameraPhoto()} disabled={Boolean(cameraError)}><Camera size={16} /> Capturar foto</button></section></div>}
    {zoomedImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Visualização de ${zoomedImage.name}`} onMouseDown={(event) => event.target === event.currentTarget && setZoomedImage(null)}><button className="image-lightbox-close" onClick={() => setZoomedImage(null)} aria-label="Fechar"><X size={22} /></button><img src={zoomedImage.url} alt={zoomedImage.name} /><span>{zoomedImage.name}</span></div>}
  </>;
}

async function prepareProfileImage(file: File, maxWidth: number, maxHeight: number) {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", .82);
  } finally { URL.revokeObjectURL(objectUrl); }
}

function ProfileEditor({ user, onClose, onSaved }: { user: SocialUser; onClose: () => void; onSaved: (user: SocialUser) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [bannerUrl, setBannerUrl] = useState<string | null>(user.bannerUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const chooseImage = async (file: File | undefined, kind: "avatar" | "banner") => {
    if (!file) return;
    setError("");
    try {
      const data = await prepareProfileImage(file, kind === "avatar" ? 512 : 1600, kind === "avatar" ? 512 : 600);
      if (kind === "avatar") setAvatarUrl(data); else setBannerUrl(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível ler a imagem"); }
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const changed = await social.updateMe({ displayName: displayName.trim(), bio: bio.trim(), avatarUrl, bannerUrl });
      onSaved(changed); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar o perfil"); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal profile-editor" onMouseDown={(event) => event.stopPropagation()}>
    <button aria-label="Fechar editor de perfil" className="modal-close icon-button" onClick={onClose}><X size={19} /></button><span className="modal-icon"><Pencil size={21} /></span><h2>Editar perfil</h2><p>Personalize como seu trabalho aparece para amigos e no link público.</p>
    <div className="profile-media-editor">
      <div className="banner-preview" style={{ backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined }}><label><ImagePlus size={15} /> Alterar banner<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event.target.files?.[0], "banner")} /></label>{bannerUrl && <button onClick={() => setBannerUrl(null)}>Remover</button>}</div>
      <div className="avatar-preview" style={{ background: user.avatarColor, backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined }}>{!avatarUrl && initials}<label title="Alterar foto"><Camera size={15} /><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event.target.files?.[0], "avatar")} /></label></div>
    </div>
    <label>Nome público<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></label>
    <label>Descrição<textarea value={bio} maxLength={280} onChange={(event) => setBio(event.target.value)} placeholder="Conte o que você cria..." /><small>{bio.length}/280</small></label>
    {avatarUrl && <button className="profile-remove-photo" onClick={() => setAvatarUrl(null)}>Remover foto</button>}
    {error && <div className="auth-error">{error}</div>}
    <button className="primary-button modal-save" disabled={busy || displayName.trim().length < 2} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar perfil"}</button>
  </div></div>;
}

function ProfileView({ apps, heatmap, user, friendCount, onCopy, onUserChanged }: { apps: TrackedApp[]; heatmap: HeatmapDay[]; user: SocialUser; friendCount: number; onCopy: () => void; onUserChanged: (user: SocialUser) => void }) {
  const [editing, setEditing] = useState(false);
  const total = heatmap.reduce((sum, day) => sum + day.seconds, 0);
  const running = apps.find((app) => app.status === "running");
  const initials = user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <div className="page profile-page">
      <section className="profile-cover" style={{ backgroundImage: user.bannerUrl ? `url(${user.bannerUrl})` : undefined }}><div className="cover-grid" /><div className="profile-cover-actions"><button className="secondary-button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit profile</button><button className="secondary-button" onClick={() => window.open(`${social.apiUrl}/p/${user.handle}`, "_blank")}><ExternalLink size={15} /> Open public profile</button><button className="secondary-button" onClick={onCopy}><Link2 size={16} /> Copy link</button></div></section>
      <section className="profile-card">
        <div className="own-avatar" style={{ background: user.avatarColor, backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : undefined }}>{!user.avatarUrl && initials}<i /></div>
        <div className="profile-identity"><h1>{user.displayName}</h1><span>@{user.handle}</span><p>{user.bio || "Creating something worth remembering."}</p></div>
        <div className="profile-numbers"><div><strong>{friendCount}</strong><span>Friends</span></div><div><strong>{Math.floor(total / 3600).toLocaleString()}</strong><span>Hours</span></div><div><strong>{heatmap.filter((day) => day.seconds).length}</strong><span>Active days</span></div></div>
      </section>
      {running && <section className="public-now panel"><div className="now-main"><SoftwareIcon app={running} /><div className="now-copy"><span className="now-label"><i /> Online now</span><h2>Working in {running.name}</h2><p>{formatDuration(running.todaySeconds, true)} this session</p></div></div><span className="visibility"><Users size={15} /> Visible to everyone</span></section>}
      <section className="panel"><SectionTitle title={`${user.displayName.split(" ")[0]}'s creative year`} /><Heatmap days={heatmap} compact /></section>
      <section className="profile-software"><SectionTitle title="Most used software" />
        <div className="profile-app-list">{apps.slice(0, 3).map((app, index) => <div key={app.id}><span className="rank">0{index + 1}</span><SoftwareIcon app={app} size="sm" /><div><strong>{app.name}</strong><span>{formatDuration(app.totalSeconds, true)}</span></div><ChevronRight size={17} /></div>)}</div>
      </section>
      {editing && <ProfileEditor user={user} onClose={() => setEditing(false)} onSaved={onUserChanged} />}
    </div>
  );
}

function fullYearDays(daily: ApiProfile["daily"]): HeatmapDay[] {
  const byDate = new Map(daily.map((day) => [String(day.date).slice(0, 10), Number(day.seconds)]));
  return Array.from({ length: 364 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (363 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date: key, seconds: byDate.get(key) ?? 0 };
  });
}

function FriendProfileView({ data, onBack }: { data: ApiProfile; onBack: () => void }) {
  const { profile, presence } = data;
  const initials = profile.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const year = useMemo(() => fullYearDays(data.daily), [data.daily]);
  const total = data.daily.reduce((sum, day) => sum + Number(day.seconds), 0);
  const recent = [...data.totals].filter((app) => app.lastOpenedAt).sort((a, b) => new Date(b.lastOpenedAt!).getTime() - new Date(a.lastOpenedAt!).getTime()).slice(0, 5);
  const workingNow = presence?.status !== "offline" && presence?.currentAppName;
  return (
    <div className="page profile-page friend-profile-page">
      <button className="secondary-button friend-profile-back" onClick={onBack}><ArrowLeft size={16} /> Voltar para a conversa</button>
      <section className="profile-cover" style={{ backgroundImage: profile.bannerUrl ? `url(${profile.bannerUrl})` : undefined }}><div className="cover-grid" /></section>
      <section className="profile-card">
        <div className="own-avatar" style={{ background: profile.avatarColor, backgroundImage: profile.avatarUrl ? `url(${profile.avatarUrl})` : undefined }}>{!profile.avatarUrl && initials}<i /></div>
        <div className="profile-identity"><h1>{profile.displayName}</h1><span>@{profile.handle}</span><p>{profile.bio || "Criando algo que vale lembrar."}</p></div>
        <div className="profile-numbers"><div><strong>{data.friendCount}</strong><span>Amigos</span></div><div><strong>{formatDuration(total, true)}</strong><span>Tempo total</span></div><div><strong>{year.filter((day) => day.seconds > 0).length}</strong><span>Dias ativos</span></div></div>
      </section>
      {workingNow && <section className="public-now panel friend-now"><div className="now-main"><span className="friend-now-icon"><Sparkles size={20} /></span><div className="now-copy"><span className="now-label"><i /> Trabalhando agora</span><h2>{presence.currentAppName}</h2><p>Atividade atualizada em tempo real</p></div></div><span className="visibility"><Users size={15} /> Visível para você</span></section>}
      <section className="panel friend-year"><SectionTitle title="Atividade nos últimos 12 meses" action={<span className="muted-label">{year.filter((day) => day.seconds > 0).length} dias ativos</span>} /><Heatmap days={year} /></section>
      <section className="friend-profile-columns">
        <div className="panel"><SectionTitle title="Softwares mais usados" /><div className="profile-app-list">{data.totals.slice(0, 5).map((app, index) => <div key={app.appId}><span className="rank">{String(index + 1).padStart(2, "0")}</span><div><strong>{app.appName}</strong><span>{formatDuration(Number(app.totalSeconds), true)}</span></div></div>)}</div></div>
        <div className="panel"><SectionTitle title="Usados recentemente" /><div className="profile-app-list">{recent.map((app) => <div key={app.appId}><Clock3 size={17} /><div><strong>{app.appName}</strong><span>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(app.lastOpenedAt!))}</span></div></div>)}{!recent.length && <p className="profile-empty">Nenhuma abertura registrada ainda.</p>}</div></div>
      </section>
    </div>
  );
}

function SettingsView({ user, testFriend, uiScale, onUiScale, onUserChanged, onLogout, onSwitchAccount, onExport }: { user: SocialUser; testFriend?: Friend; uiScale: number; onUiScale: (scale: number) => void; onUserChanged: (user: SocialUser) => void; onLogout: () => void; onSwitchAccount: () => void; onExport: () => void }) {
  const [publicProfile, setPublicProfile] = useState(user.profileVisibility === "public");
  const [presenceVisibility, setPresenceVisibility] = useState(user.presenceVisibility);
  const [notifications, setNotifications] = useState(localStorage.getItem("workdeck.notifications") !== "false");
  const [automaticUpdates, setAutomaticUpdates] = useState(localStorage.getItem("workdeck.automatic-updates") !== "false");
  const [apiUrl, setApiUrl] = useState(social.apiUrl);
  const [blockedUsers, setBlockedUsers] = useState<Array<SocialUser & { blockedAt: string }>>([]);
  const [p2pTest, setP2pTest] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [audioProcessing, setAudioProcessing] = useState<AudioProcessingSettings>(() => { try { return { ...defaultAudioProcessing, ...JSON.parse(localStorage.getItem("workdeck.audio-processing") ?? "{}") }; } catch { return defaultAudioProcessing; } });
  const [streamDefaults, setStreamDefaults] = useState<StreamSettings>(() => { try { return { ...defaultStreamSettings, ...JSON.parse(localStorage.getItem("workdeck.stream-settings") ?? "{}") }; } catch { return defaultStreamSettings; } });
  useEffect(() => { void social.blockedUsers().then(setBlockedUsers).catch(() => undefined); }, []);
  const updatePrivacy = async (key: "profileVisibility" | "presenceVisibility", enabled: boolean) => {
    const changed = await social.updateMe({ [key]: enabled ? (key === "profileVisibility" ? "public" : "friends") : "private" });
    onUserChanged(changed);
  };
  const updateAudio = (key: keyof AudioProcessingSettings, value: boolean) => {
    const next = { ...audioProcessing, [key]: value };
    setAudioProcessing(next);
    localStorage.setItem("workdeck.audio-processing", JSON.stringify(next));
  };
  const updateStream = (next: StreamSettings) => { setStreamDefaults(next); localStorage.setItem("workdeck.stream-settings", JSON.stringify(next)); };
  return (
    <div className="page settings-page">
      <div className="page-heading"><div><span className="eyebrow">Your preferences</span><h1>Settings</h1><p>Control tracking, privacy, and notifications.</p></div></div>
      <section className="panel settings-panel">
        <SectionTitle title="Interface" />
        <div className="setting-row ui-scale-setting"><div><strong>Escala do aplicativo</strong><p>Aumente textos e controles em monitores ultrawide ou de alta resolução.</p></div><label><input type="range" min="80" max="150" step="5" value={uiScale} onChange={(event) => onUiScale(Number(event.target.value))} /><span>{uiScale}%</span></label></div>
      </section>
      <section className="panel settings-panel">
        <SectionTitle title="Privacy & presence" />
        <SettingRow title="Public profile" description="Anyone with your profile link can see your hours and recent software." value={publicProfile} onChange={(value) => { setPublicProfile(value); void updatePrivacy("profileVisibility", value); }} />
        <div className="setting-row"><div><strong>Live software presence</strong><p>Choose who can see which tracked software is currently open.</p></div><select value={presenceVisibility} onChange={async (event) => { const value = event.target.value as SocialUser["presenceVisibility"]; setPresenceVisibility(value); onUserChanged(await social.updateMe({ presenceVisibility: value })); }}><option value="public">Everyone with my link</option><option value="friends">Friends only</option><option value="private">Nobody</option></select></div>
        <SettingRow title="Friend activity notifications" description="Show a Steam-style card in the corner when a friend opens software." value={notifications} onChange={(value) => { setNotifications(value); localStorage.setItem("workdeck.notifications", String(value)); }} />
        <button className="secondary-button notification-test" onClick={() => void notifySoftwareStarted(testFriend?.id ?? "", testFriend?.name ?? user.displayName, "Premiere Pro")}><BellRing size={16} /> Testar aviso estilo Steam</button>
      </section>
      <section className="panel settings-panel">
        <SectionTitle title="Voz & transmissão" />
        <SettingRow title="Cancelamento de eco" description="Evita que a voz dos participantes volte pelo seu microfone." value={audioProcessing.echoCancellation} onChange={(value) => updateAudio("echoCancellation", value)} />
        <SettingRow title="Supressão de ruído" description="Reduz sons constantes como ventilador, teclado e ambiente." value={audioProcessing.noiseSuppression} onChange={(value) => updateAudio("noiseSuppression", value)} />
        <SettingRow title="Ganho automático" description="Equilibra automaticamente o volume da sua voz." value={audioProcessing.autoGainControl} onChange={(value) => updateAudio("autoGainControl", value)} />
        <div className="settings-stream-defaults"><label>Qualidade padrão<select value={streamDefaults.quality} onChange={(event) => updateStream({ ...streamDefaults, quality: event.target.value as StreamQuality })}><option value="720p">720p</option><option value="1080p">1080p</option><option value="1440p">1440p</option><option value="source">SOURCE</option></select></label><label>FPS<select value={streamDefaults.fps} onChange={(event) => updateStream({ ...streamDefaults, fps: Number(event.target.value) as 15 | 30 | 60 })}><option value="15">15 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label><label>Bitrate<select value={streamDefaults.bitrateMbps} onChange={(event) => updateStream({ ...streamDefaults, bitrateMbps: Number(event.target.value) as 2 | 4 | 6 | 8 | 10 })}><option value="2">2 Mbps</option><option value="4">4 Mbps</option><option value="6">6 Mbps</option><option value="8">8 Mbps</option><option value="10">10 Mbps</option></select></label></div>
        <span className="settings-success">As mudanças do microfone entram em vigor na próxima entrada em uma call.</span>
      </section>
      <section className="panel settings-panel">
        <SectionTitle title="Server & data" />
        <SettingRow title="Atualizações automáticas" description="Baixa, verifica a assinatura e instala novas versões sem precisar de outro setup." value={automaticUpdates} onChange={(value) => { setAutomaticUpdates(value); localStorage.setItem("workdeck.automatic-updates", String(value)); window.dispatchEvent(new CustomEvent("workdeck-update-preference", { detail: { enabled: value } })); }} />
        <div className="settings-note"><ShieldCheck size={21} /><div><strong>Local-first activity history</strong><p>Process detection and raw session events stay on this device. Only the presence and totals you choose are shared.</p></div></div>
        <label className="settings-server">API server<input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} /><button className="secondary-button" onClick={() => social.setApiUrl(apiUrl)}>Save server</button></label>
        <button className="secondary-button update-check-button" onClick={() => window.dispatchEvent(new CustomEvent("workdeck-check-update", { detail: { manual: true } }))}><RefreshCw size={16} /> Verificar atualizações</button>
        <button className="secondary-button" onClick={onExport}><Download size={16} /> Export activity as CSV</button>
        <button className="secondary-button p2p-self-test" disabled={p2pTest === "testing"} onClick={async () => { setP2pTest("testing"); try { await runP2PSelfTest(); setP2pTest("ok"); } catch { setP2pTest("error"); } }}><ShieldCheck size={16} /> {p2pTest === "testing" ? "Testing P2P…" : "Test P2P on this PC"}</button>
        {p2pTest === "ok" && <span className="settings-success">P2P test passed — bytes traveled directly between two local peers.</span>}
        {p2pTest === "error" && <span className="settings-error">P2P test failed on this network/device.</span>}
        {blockedUsers.length > 0 && <div className="blocked-users"><span className="group-label">Blocked users</span>{blockedUsers.map((blocked) => <div key={blocked.id}><span className="avatar avatar-sm" style={{ background: blocked.avatarColor }}>{blocked.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><p><strong>{blocked.displayName}</strong><span>@{blocked.handle}</span></p><button className="secondary-button" onClick={async () => { await social.unblockUser(blocked.id); setBlockedUsers((current) => current.filter((item) => item.id !== blocked.id)); }}>Unblock</button></div>)}</div>}
        <button className="secondary-button switch-account" onClick={onSwitchAccount}>Use another account in this window</button>
        <button className="danger-button" onClick={onLogout}>Sign out</button>
      </section>
    </div>
  );
}

function SettingRow({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><button className={`toggle ${value ? "active" : ""}`} onClick={() => onChange(!value)} aria-pressed={value}><i /></button></div>;
}

function AddSoftwareModal({ onClose, onSaved }: { onClose: () => void; onSaved: (app: TrackedApp) => void }) {
  const [name, setName] = useState("");
  const [processName, setProcessName] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || !processName.trim()) return;
    setSaving(true);
    const color = "#72d8a3";
    await addTrackedApp(name.trim(), processName.trim(), color);
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    onSaved({ id, name: name.trim(), shortName: name.slice(0, 2), category: "Custom software", color, glow: "rgba(114,216,163,.3)", totalSeconds: 0, todaySeconds: 0, lastOpened: "Not opened yet", status: "idle", processNames: [processName.trim()] });
    onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close icon-button" onClick={onClose}><X size={19} /></button>
        <span className="modal-icon"><Plus size={22} /></span><h2>Add software</h2><p>Choose the app name and its process on Windows or macOS. Workdeck will recognize it automatically.</p>
        <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="DaVinci Resolve" autoFocus /></label>
        <label>Process name<input value={processName} onChange={(event) => setProcessName(event.target.value)} placeholder="Resolve.exe" /></label>
        <div className="modal-hint"><ShieldCheck size={15} /> Detection happens only on this device.</div>
        <button className="primary-button modal-save" onClick={save} disabled={!name.trim() || !processName.trim() || saving}>{saving ? "Adding…" : "Add to library"}</button>
      </div>
    </div>
  );
}

function WorkdeckApp() {
  const [authState, setAuthState] = useState<"loading" | "guest" | "ready">(social.hasSession() ? "loading" : "guest");
  const [currentUser, setCurrentUser] = useState<SocialUser | null>(null);
  const [view, setView] = useState<View>("home");
  const [apps, setApps] = useState<TrackedApp[]>(mockApps);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>(mockHeatmap);
  const [appDaily, setAppDaily] = useState<AppActivityDay[]>([]);
  const [apiFriends, setApiFriends] = useState<ApiFriend[]>([]);
  const [friendRequests, setFriendRequests] = useState<{ incoming: ApiFriendRequest[]; outgoing: ApiFriendRequest[] }>({ incoming: [], outgoing: [] });
  const [friendPanel, setFriendPanel] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showFriendManager, setShowFriendManager] = useState(false);
  const [toast, setToast] = useState("");
  const [viewedProfile, setViewedProfile] = useState<ApiProfile | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [pendingChatAttachment, setPendingChatAttachment] = useState<File | null>(null);
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  const [studioChatContacts, setStudioChatContacts] = useState<Friend[]>([]);
  const [uiScale, setUiScale] = useState(() => Math.min(150, Math.max(80, Number(localStorage.getItem("workdeck.ui-scale")) || 100)));
  const [activeCall, setActiveCall] = useState<{ communityName: string; channelName: string } | null>(null);
  const previousRunning = useRef<string[]>([]);
  const activitySyncFailed = useRef(false);
  const apiFriendsRef = useRef<ApiFriend[]>([]);
  const friends = useMemo(() => apiFriends.map((friend) => ({ ...mapFriend(friend), mutualFriends: friend.unreadCount })), [apiFriends]);
  const chatFriends = useMemo(() => [...friends, ...studioChatContacts.filter((contact) => !friends.some((friend) => friend.id === contact.id))], [friends, studioChatContacts]);
  const unreadCount = apiFriends.reduce((sum, friend) => sum + friend.unreadCount, 0);
  const initials = currentUser?.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() ?? "WD";

  useEffect(() => { apiFriendsRef.current = apiFriends; }, [apiFriends]);

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const ratio = uiScale / 100;
    root.style.setProperty("zoom", String(ratio));
    root.style.width = `${100 / ratio}%`;
    root.style.height = `${100 / ratio}%`;
    localStorage.setItem("workdeck.ui-scale", String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const nativeWindow = getCurrentWindow();
      const dispose = await nativeWindow.onResized(() => {
        window.setTimeout(async () => {
          if (await nativeWindow.isMinimized()) {
            try { await nativeWindow.setSkipTaskbar(true); } catch { /* Não existe no macOS. */ }
            await nativeWindow.hide();
          }
        }, 250);
      });
      if (cancelled) dispose(); else unlisten = dispose;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("@tauri-apps/plugin-deep-link").then(async ({ getCurrent, onOpenUrl }) => {
      const receive = (urls: string[]) => {
        const invite = urls.map((raw) => raw.match(/^workdeck:\/\/invite\/([^/?#]+)/i)?.[1]).find(Boolean);
        if (!invite) return;
        setPendingInviteCode(decodeURIComponent(invite));
        setView("studios");
      };
      receive(await getCurrent() ?? []);
      const unlisten = await onOpenUrl(receive);
      if (cancelled) unlisten(); else dispose = unlisten;
    }).catch(() => undefined);
    return () => { cancelled = true; dispose?.(); };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const dispose = await listen<string>("open-friend-chat", ({ payload }) => {
        if (!payload) return;
        setSelectedFriendId(payload);
        setViewedProfile(null);
        setCurrentView("chat");
      });
      if (cancelled) dispose(); else unlisten = dispose;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  const refreshSocial = useCallback(async () => {
    const [nextFriends, nextRequests] = await Promise.all([social.friends(), social.requests()]);
    setApiFriends(nextFriends);
    setFriendRequests(nextRequests);
  }, []);
  const markConversationLocallyRead = useCallback((userId: string) => {
    setApiFriends((current) => current.map((friend) => friend.id === userId ? { ...friend, unreadCount: 0 } : friend));
  }, []);

  useEffect(() => {
    if (!social.hasSession()) return;
    social.me().then((user) => { setCurrentUser(user); setAuthState("ready"); }).catch(() => setAuthState("guest"));
  }, []);

  useEffect(() => {
    if (authState !== "ready" || !("locks" in navigator) || !("__TAURI_INTERNALS__" in window)) return;
    let releaseLock: (() => void) | undefined;
    const keepAlive = new Promise<void>((resolve) => { releaseLock = resolve; });
    void navigator.locks.request("workdeck-background-runtime", () => keepAlive);
    return () => releaseLock?.();
  }, [authState]);

  useEffect(() => {
    if (authState !== "ready") return;
    void refreshSocial().catch((reason) => setToast(reason.message));
    social.connectRealtime();
    const unsubscribe = social.subscribe((event) => {
      if (event.type === "presence.updated") {
        const changed = apiFriendsRef.current.find((friend) => friend.id === event.userId);
        setApiFriends((current) => current.map((friend) => friend.id === event.userId ? { ...friend, status: event.presence.status, currentAppId: event.presence.currentAppId, currentAppName: event.presence.currentAppName, sessionStartedAt: event.presence.sessionStartedAt } : friend));
        if (changed && event.presence.currentAppName && changed.currentAppName !== event.presence.currentAppName) {
          void notifySoftwareStarted(changed.id, changed.displayName, event.presence.currentAppName);
        }
      }
      if (event.type === "friend.requested") {
        setFriendRequests((current) => ({ ...current, incoming: [event.request, ...current.incoming.filter((item) => item.id !== event.request.id)] }));
        setToast(`${event.request.user.displayName} sent you a friend request`);
      }
      if (event.type === "friend.accepted" || event.type === "friend.removed") void refreshSocial();
      if (event.type === "community.invited") setToast(`${event.invite.creatorName} convidou você para ${event.invite.communityName}`);
      if (event.type === "message.created" && event.message.senderId !== currentUser?.id) {
        setApiFriends((current) => current.map((friend) => friend.id === event.message.senderId ? { ...friend, unreadCount: friend.unreadCount + 1 } : friend));
      }
    });
    return () => unsubscribe();
  }, [authState, currentUser?.id, refreshSocial]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      try {
        const snapshot = await getActivitySnapshot();
        if (!active) return;
        const running = snapshot.apps.filter((app) => app.status === "running").map((app) => app.id);
        const newlyRunning = snapshot.apps.filter((app) => running.includes(app.id) && !previousRunning.current.includes(app.id));
        if (previousRunning.current.length && newlyRunning.length) setToast(`${newlyRunning[0].name} is now being tracked`);
        previousRunning.current = running;
        setApps((current) => {
          const customApps = current.filter((app) => app.category === "Custom software");
          return [
            ...snapshot.apps,
            ...customApps.filter((custom) => !snapshot.apps.some((app) => app.id === custom.id))
          ];
        });
        setHeatmap(snapshot.heatmap.length ? snapshot.heatmap : mockHeatmap);
        setAppDaily(snapshot.appDaily);
        if (authState === "ready" && "__TAURI_INTERNALS__" in window) {
          void social.syncActivity(snapshot).then(() => { activitySyncFailed.current = false; }).catch((reason) => {
            if (!activitySyncFailed.current) setToast(reason instanceof Error ? `Atividade local salva, mas não sincronizada: ${reason.message}` : "A atividade não pôde ser sincronizada");
            activitySyncFailed.current = true;
          });
        }
      } catch {
        setToast("Using demo activity — native tracker is unavailable in the browser");
      }
    };
    void sync();
    const timer = window.setInterval(sync, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authState]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const setCurrentView = (next: View) => { setView(next); setMobileNav(false); };
  const openDirectMessage = (userId: string, file?: File, member?: CommunityMember) => {
    if (member && !friends.some((friend) => friend.id === member.id)) {
      setStudioChatContacts((current) => [...current.filter((contact) => contact.id !== member.id), {
        id: member.id,
        name: member.displayName,
        handle: `@${member.handle}`,
        avatar: member.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
        avatarColor: member.avatarColor,
        avatarUrl: member.avatarUrl,
        status: member.status,
        currentApp: member.currentAppName ?? undefined,
        currentAppColor: member.currentAppName ? "#72e3a2" : undefined,
        currentActivity: member.currentAppName ? "Working now" : undefined,
        lastSeen: member.status === "offline" ? "Offline" : member.status,
        isFriend: false
      }]);
    }
    setSelectedFriendId(userId);
    setPendingChatAttachment(file ?? null);
    setCurrentView("chat");
  };
  const openFriendProfile = async (friend: Friend) => {
    setSelectedFriendId(friend.id);
    try {
      setViewedProfile(await social.profile(friend.handle));
      setCurrentView("friend-profile");
    } catch (reason) { setToast(reason instanceof Error ? reason.message : "Não foi possível abrir o perfil"); }
  };
  const copyProfile = async () => {
    await navigator.clipboard?.writeText(`${social.apiUrl}/p/${currentUser?.handle ?? ""}`);
    setToast("Profile link copied");
  };

  const logout = async () => {
    await social.logout();
    setCurrentUser(null);
    setApiFriends([]);
    setAuthState("guest");
  };

  const switchAccount = () => {
    social.switchAccount();
    setCurrentUser(null);
    setApiFriends([]);
    setAuthState("guest");
  };

  const exportActivity = () => {
    const appNames = new Map(apps.map((app) => [app.id, app.name]));
    const rows = [
      ["data", "software", "horas", "segundos"],
      ...appDaily.map((day) => [day.date, appNames.get(day.appId) ?? day.appId, (day.seconds / 3600).toFixed(2), String(day.seconds)])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `workdeck-atividade-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setToast("Activity exported as CSV");
  };

  if (authState === "loading") return <div className="loading-screen"><AppLogo size={56} /><span>Connecting your workspace…</span></div>;
  if (authState === "guest" || !currentUser) return <AuthView onAuthenticated={(user) => { setCurrentUser(user); setAuthState("ready"); }} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <button className="mobile-close icon-button" onClick={() => setMobileNav(false)}><X size={19} /></button>
        <button className="brand" onClick={() => setCurrentView("home")}><AppLogo /><span>workdeck</span></button>
        <nav>
          <span className="nav-label">Workspace</span>
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => setCurrentView(id)}><Icon size={19} /><span>{label}</span>{id === "chat" && unreadCount > 0 && <i className="nav-count">{unreadCount}</i>}</button>)}
          <span className="nav-label nav-label-social">Social</span>
          <button onClick={() => setFriendPanel(!friendPanel)}><Users size={19} /><span>Friends</span><i className="online-count">{friends.filter((friend) => friend.status !== "offline").length}</i></button>
        </nav>
        <div className="sidebar-bottom">
          <button className={view === "settings" ? "active" : ""} onClick={() => setCurrentView("settings")}><Settings size={19} /> Settings</button>
          <button className={`mini-profile ${view === "profile" ? "selected" : ""}`} onClick={() => setCurrentView("profile")}>
            <span className="own-avatar own-avatar-small" style={{ background: currentUser.avatarColor, backgroundImage: currentUser.avatarUrl ? `url(${currentUser.avatarUrl})` : undefined }}>{!currentUser.avatarUrl && initials}<i /></span><span><strong>{currentUser.displayName}</strong><small>Online</small></span><ChevronDown size={15} />
          </button>
        </div>
      </aside>
      {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}

      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <label className="global-search"><Search size={17} /><input placeholder="Search software, friends, activity..." /><kbd>⌘ K</kbd></label>
          <div className="top-actions">
            <button className="icon-button notification-button" onClick={() => setShowNotifications(!showNotifications)}><Bell size={19} />{friendRequests.incoming.length > 0 && <i />}</button>
            <button className="friend-toggle" onClick={() => setFriendPanel(!friendPanel)}><Users size={17} /><span>{friends.filter((friend) => friend.status !== "offline").length} online</span></button>
          </div>
          {showNotifications && <div className="notification-popover"><div><strong>Notifications</strong><button onClick={() => setShowNotifications(false)}><X size={15} /></button></div>{friendRequests.incoming.map((request) => <article key={request.id} onClick={() => setShowFriendManager(true)}><span className="notice-icon"><UserPlus size={16} /></span><p><strong>{request.user.displayName} wants to be friends</strong><span>@{request.user.handle}</span></p></article>)}{!friendRequests.incoming.length && <div className="empty-notifications">You're all caught up.</div>}</div>}
        </header>

        <main className={view === "chat" || view === "studios" ? "main-chat" : ""}>
          {view === "home" && <HomeView apps={apps} heatmap={heatmap} friends={friends} userName={currentUser.displayName} onViewChange={setCurrentView} />}
          {view === "library" && <LibraryView apps={apps} onAdd={() => setShowAdd(true)} />}
          {view === "activity" && <ActivityView apps={apps} heatmap={heatmap} appDaily={appDaily} onExport={exportActivity} />}
          {view === "leaderboard" && <LeaderboardView onOpenChat={(userId) => { setSelectedFriendId(userId); setCurrentView("chat"); }} />}
          <div className={`studio-host ${view === "studios" ? "" : "studio-host-hidden"}`} aria-hidden={view !== "studios"}><StudiosView currentUser={currentUser} friends={apiFriends} pendingInviteCode={pendingInviteCode} onInviteHandled={() => setPendingInviteCode(null)} onOpenDm={openDirectMessage} onToast={setToast} onCallStateChange={setActiveCall} /></div>
          {view === "chat" && <ChatView friends={chatFriends} currentUserId={currentUser.id} initialFriendId={selectedFriendId} initialAttachment={pendingChatAttachment} onInitialAttachmentConsumed={() => setPendingChatAttachment(null)} onFriendsChanged={refreshSocial} onConversationRead={markConversationLocallyRead} onOpenProfile={(friend) => void openFriendProfile(friend)} />}
          {view === "friend-profile" && viewedProfile && <FriendProfileView data={viewedProfile} onBack={() => setCurrentView("chat")} />}
          {view === "profile" && <ProfileView apps={apps} heatmap={heatmap} user={currentUser} friendCount={friends.length} onCopy={copyProfile} onUserChanged={setCurrentUser} />}
          {view === "settings" && <SettingsView user={currentUser} testFriend={friends[0]} uiScale={uiScale} onUiScale={setUiScale} onUserChanged={setCurrentUser} onLogout={() => void logout()} onSwitchAccount={switchAccount} onExport={exportActivity} />}
        </main>
      </div>

      {friendPanel && view !== "chat" && view !== "studios" && (
        <aside className="friends-panel">
          <div className="friends-heading"><div><h3>Friends</h3><span>{friends.filter((friend) => friend.status !== "offline").length} online</span></div><button className="icon-button" onClick={() => setShowFriendManager(true)}><UserPlus size={17} /></button></div>
          <label className="inline-search"><Search size={14} /><input placeholder="Find friends" /></label>
          <div className="friend-group"><span className="group-label">Working now — {friends.filter((friend) => friend.currentApp).length}</span>{friends.filter((friend) => friend.currentApp).map((friend) => <button className="friend-row" key={friend.id} onClick={() => { setSelectedFriendId(friend.id); setCurrentView("chat"); }}><Avatar friend={friend} /><div><strong>{friend.name}</strong><span><i style={{ background: friend.currentAppColor }} />{friend.currentApp}</span></div><MessageCircle size={15} /></button>)}</div>
          <div className="friend-group"><span className="group-label">Available & offline — {friends.filter((friend) => !friend.currentApp).length}</span>{friends.filter((friend) => !friend.currentApp).map((friend) => <button className={`friend-row ${friend.status === "offline" ? "is-offline" : ""}`} key={friend.id} onClick={() => { setSelectedFriendId(friend.id); setCurrentView("chat"); }}><Avatar friend={friend} /><div><strong>{friend.name}</strong><span>{friend.status === "online" ? "Online" : friend.lastSeen}</span></div></button>)}</div>
          {!friends.length && <div className="empty-friends"><Users size={22} /><span>Your crew will appear here.</span></div>}
          <button className="add-friend-button" onClick={() => setShowFriendManager(true)}><Plus size={16} /> Add a friend</button>
        </aside>
      )}

      {showAdd && <AddSoftwareModal onClose={() => setShowAdd(false)} onSaved={(app) => { setApps((current) => [...current, app]); setToast(`${app.name} added to your library`); }} />}
      {showFriendManager && <FriendManager incoming={friendRequests.incoming} outgoing={friendRequests.outgoing} onClose={() => setShowFriendManager(false)} onChanged={refreshSocial} />}
      {activeCall && view !== "studios" && <button className="active-call-pill" onClick={() => setCurrentView("studios")}><span><Headphones size={17} /></span><div><strong>Call em andamento</strong><small>{activeCall.communityName} · {activeCall.channelName}</small></div><Radio size={15} /></button>}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  );
}

function SteamActivityWindow() {
  const query = new URLSearchParams(window.location.search);
  const friendId = query.get("friendId") || "";
  const displayName = query.get("displayName") || "Um amigo";
  const softwareName = query.get("softwareName") || "um software";
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  useEffect(() => {
    document.documentElement.classList.add("steam-overlay-document");
    const timer = window.setTimeout(() => {
      if ("__TAURI_INTERNALS__" in window) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close());
    }, 6_200);
    return () => { document.documentElement.classList.remove("steam-overlay-document"); window.clearTimeout(timer); };
  }, []);
  const openChat = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await invoke("open_friend_chat", { friendId });
    await getCurrentWindow().close();
  };
  return <button className="steam-desktop-notice" onClick={() => void openChat()} title={friendId ? `Abrir conversa com ${displayName}` : "Abrir Workdeck"}><span className="steam-notice-avatar">{initials}</span><span className="steam-notice-copy"><strong>{displayName}</strong><span>começou a usar</span><b>{softwareName}</b></span><i /></button>;
}

type DesktopUpdateInfo = {
  version: string;
  currentVersion: string;
  notes: string | null;
  publishedAt: string | null;
};

type DesktopUpdateProgress = {
  downloaded: number;
  total: number | null;
  percent: number | null;
  finished: boolean;
};

function DesktopUpdater() {
  const [update, setUpdate] = useState<DesktopUpdateInfo | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "installing" | "restarting" | "current" | "error">("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [dismissedVersion, setDismissedVersion] = useState("");
  const [automaticSeconds, setAutomaticSeconds] = useState<number | null>(null);
  const [automaticUpdates, setAutomaticUpdates] = useState(localStorage.getItem("workdeck.automatic-updates") !== "false");

  const check = useCallback(async (manual = false) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (manual) { setStatus("checking"); setError(""); }
    try {
      const found = await invoke<DesktopUpdateInfo | null>("check_for_update", { apiUrl: social.apiUrl });
      if (found) {
        setUpdate(found);
        setDismissedVersion("");
        setStatus("available");
      } else if (manual) {
        setUpdate(null);
        setStatus("current");
        window.setTimeout(() => setStatus((value) => value === "current" ? "idle" : value), 3_500);
      }
    } catch (reason) {
      if (manual) {
        setError(String(reason));
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const startup = window.setTimeout(() => void check(false), 5_000);
    const interval = window.setInterval(() => void check(false), 4 * 60 * 60 * 1_000);
    const manualCheck = (event: Event) => void check(Boolean((event as CustomEvent<{ manual?: boolean }>).detail?.manual));
    const preferenceChanged = (event: Event) => setAutomaticUpdates(Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled));
    window.addEventListener("workdeck-check-update", manualCheck);
    window.addEventListener("workdeck-update-preference", preferenceChanged);
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const dispose = await listen<DesktopUpdateProgress>("update-progress", ({ payload }) => {
        setPercent(payload.percent);
        if (payload.finished) setStatus("restarting");
      });
      if (cancelled) dispose(); else unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener("workdeck-check-update", manualCheck);
      window.removeEventListener("workdeck-update-preference", preferenceChanged);
    };
  }, [check]);

  const install = useCallback(async () => {
    setStatus("installing");
    setPercent(0);
    setError("");
    try {
      await invoke("install_update", { apiUrl: social.apiUrl });
      setStatus("restarting");
    } catch (reason) {
      setError(String(reason));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (status !== "available" || !update || update.version === dismissedVersion || !automaticUpdates) {
      setAutomaticSeconds(null);
      return;
    }
    let remaining = 30;
    setAutomaticSeconds(remaining);
    const timer = window.setInterval(() => {
      remaining -= 1;
      setAutomaticSeconds(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        void install();
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [automaticUpdates, dismissedVersion, install, status, update]);

  const visible = status === "checking" || status === "current" || status === "error" || (update && update.version !== dismissedVersion);
  if (!visible) return null;
  return (
    <aside className={`desktop-update-card update-${status}`} aria-live="polite">
      <span className="desktop-update-icon"><RefreshCw size={19} className={status === "checking" || status === "installing" ? "is-spinning" : ""} /></span>
      <div className="desktop-update-copy">
        <strong>{status === "checking" ? "Procurando atualização…" : status === "current" ? "Workdeck está atualizado" : status === "installing" ? "Baixando atualização…" : status === "restarting" ? "Instalando e reiniciando…" : status === "error" ? "Não foi possível atualizar" : `Workdeck ${update?.version} disponível`}</strong>
        {status === "available" && <p>{update?.notes || "Uma nova versão está pronta para instalar."}</p>}
        {status === "available" && automaticSeconds !== null && <span className="desktop-update-countdown">Instalação automática em {automaticSeconds}s</span>}
        {status === "error" && <p>{error || "Tente novamente em alguns instantes."}</p>}
        {(status === "installing" || status === "restarting") && <div className="desktop-update-progress"><i style={{ width: `${percent ?? 12}%` }} /></div>}
        {status === "available" && <div className="desktop-update-actions"><button onClick={() => void install()}>Atualizar agora</button><button onClick={() => setDismissedVersion(update?.version ?? "")}>Depois</button></div>}
        {status === "error" && <button className="desktop-update-retry" onClick={() => void check(true)}>Tentar novamente</button>}
      </div>
    </aside>
  );
}

export default function App() {
  const query = new URLSearchParams(window.location.search);
  if (query.has("friendActivity")) return <SteamActivityWindow />;
  if (query.has("streamPopout")) return <StreamPopoutWindow />;
  return <><WorkdeckApp /><DesktopUpdater /></>;
}
