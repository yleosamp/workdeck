import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Server, ShieldCheck, Sparkles } from "lucide-react";
import { social, type SocialUser } from "../lib/social";
import { AppLogo } from "./AppLogo";

export function AuthView({ onAuthenticated }: { onAuthenticated: (user: SocialUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState(social.apiUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    social.setApiUrl(serverUrl);
    try {
      const user = mode === "login"
        ? await social.login(email, password)
        : await social.register({ email, password, handle, displayName });
      onAuthenticated(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar");
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-shell">
      <div className="auth-ambient auth-ambient-a" /><div className="auth-ambient auth-ambient-b" />
      <section className="auth-story">
        <div className="auth-brand"><AppLogo size={46} /><span>workdeck</span></div>
        <div className="auth-story-copy">
          <span className="eyebrow"><Sparkles size={13} /> Seu trabalho tem história</span>
          <h1>Transforme horas criativas em uma jornada compartilhada.</h1>
          <p>Acompanhe seu progresso, veja seus amigos trabalhando e envie arquivos direto para quem está criando com você.</p>
          <div className="auth-proof"><span><i>01</i> Atividade local e privada</span><span><i>02</i> Presença em tempo real</span><span><i>03</i> Arquivos direto entre PCs</span></div>
        </div>
        <div className="auth-privacy"><ShieldCheck size={16} /><span>O Workdeck nunca lê seus projetos ou sua tela.</span></div>
      </section>
      <section className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-mobile-brand"><AppLogo size={38} /><span>workdeck</span></div>
          <span className="eyebrow">{mode === "login" ? "Bem-vindo de volta" : "Crie seu perfil"}</span>
          <h2>{mode === "login" ? "Entre no Workdeck" : "Comece sua jornada"}</h2>
          <p>{mode === "login" ? "Sua equipe e suas horas estão esperando." : "Seu nome público poderá ser alterado depois."}</p>

          {mode === "register" && <div className="auth-pair"><label>Nome<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Alex Kim" required /></label><label>Usuário<input value={handle} onChange={(event) => setHandle(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="alexcreates" required minLength={3} /></label></div>}
          <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" required /></label>
          <label>Senha<div className="password-input"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" required minLength={8} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? "Conectando…" : mode === "login" ? "Entrar" : "Criar conta"}<ArrowRight size={17} /></button>
          <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Ainda não tem uma conta? Criar agora" : "Já tem uma conta? Entrar"}</button>
          <button className="server-toggle" type="button" onClick={() => setShowServer(!showServer)}><Server size={14} /> Configuração do servidor</button>
          {showServer && <label className="server-field">Endereço da API<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://api.seudominio.com" /><small>Use o endereço da sua VPS quando publicar.</small></label>}
        </form>
      </section>
    </div>
  );
}
