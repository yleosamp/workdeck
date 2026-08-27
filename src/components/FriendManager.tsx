import { useEffect, useState } from "react";
import { Check, Clock3, Search, UserPlus, Users, X } from "lucide-react";
import { social, type ApiFriendRequest, type SocialUser } from "../lib/social";

type Props = {
  incoming: ApiFriendRequest[];
  outgoing: ApiFriendRequest[];
  onClose: () => void;
  onChanged: () => Promise<void>;
};

function UserAvatar({ user }: { user: SocialUser }) {
  const initials = user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className="avatar avatar-md" style={{ background: user.avatarColor, backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : undefined }}>{!user.avatarUrl && initials}</span>;
}

export function FriendManager({ incoming, outgoing, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<"add" | "requests">(incoming.length ? "requests" : "add");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<SocialUser & { isFriend: boolean }>>([]);
  const [sentIds, setSentIds] = useState(new Set<string>());
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = window.setTimeout(() => social.searchUsers(query).then(setResults).catch((reason) => setError(reason.message)), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id); setError("");
    try { await action(); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível concluir"); }
    finally { setBusyId(""); }
  };

  const send = async (user: SocialUser) => {
    await run(user.id, async () => {
      await social.requestFriend(user.handle);
      setSentIds((current) => new Set(current).add(user.id));
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal friend-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button aria-label="Fechar amigos" className="modal-close icon-button" onClick={onClose}><X size={19} /></button>
        <span className="modal-icon"><Users size={22} /></span><h2>Amigos</h2><p>Adicione pessoas e acompanhe todos os pedidos em um só lugar.</p>
        <div className="friend-tabs">
          <button className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}><UserPlus size={14} /> Adicionar</button>
          <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}><Clock3 size={14} /> Solicitações{incoming.length > 0 && <i>{incoming.length}</i>}</button>
        </div>

        {tab === "add" && <>
          <label className="friend-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou @usuário" autoFocus /></label>
          <div className="friend-results">
            {results.map((user) => {
              const alreadySent = sentIds.has(user.id) || outgoing.some((request) => request.user.id === user.id);
              return <div className="request-row" key={user.id}><UserAvatar user={user} /><div><strong>{user.displayName}</strong><span>@{user.handle}</span></div>{user.isFriend ? <span className="friend-state"><Check size={13} /> Amigo</span> : alreadySent ? <span className="friend-state"><Clock3 size={13} /> Enviado</span> : <button className="request-add" disabled={busyId === user.id} onClick={() => void send(user)}><UserPlus size={14} /> {busyId === user.id ? "Enviando" : "Adicionar"}</button>}</div>;
            })}
            {query.length >= 2 && !results.length && <div className="empty-results">Nenhum usuário encontrado.</div>}
            {query.length < 2 && <div className="empty-results">Digite pelo menos duas letras ou o @usuário.</div>}
          </div>
        </>}

        {tab === "requests" && <div className="requests-tab">
          <section><span className="group-label">Recebidas — {incoming.length}</span>{incoming.map((request) => <div className="request-row" key={request.id}><UserAvatar user={request.user} /><div><strong>{request.user.displayName}</strong><span>@{request.user.handle}</span></div><button aria-label={`Aceitar ${request.user.displayName}`} className="request-accept" disabled={busyId === request.id} onClick={() => void run(request.id, () => social.acceptFriend(request.id))}><Check size={15} /></button><button aria-label={`Recusar ${request.user.displayName}`} className="request-decline" disabled={busyId === request.id} onClick={() => void run(request.id, () => social.declineFriend(request.id))}><X size={15} /></button></div>)}{!incoming.length && <div className="empty-results">Nenhuma solicitação recebida.</div>}</section>
          <section><span className="group-label">Enviadas — {outgoing.length}</span>{outgoing.map((request) => <div className="request-row" key={request.id}><UserAvatar user={request.user} /><div><strong>{request.user.displayName}</strong><span>@{request.user.handle}</span></div><button className="request-cancel" disabled={busyId === request.id} onClick={() => void run(request.id, () => social.declineFriend(request.id))}>Cancelar</button></div>)}{!outgoing.length && <div className="empty-results">Nenhuma solicitação aguardando.</div>}</section>
        </div>}
        {error && <div className="auth-error">{error}</div>}
      </div>
    </div>
  );
}
