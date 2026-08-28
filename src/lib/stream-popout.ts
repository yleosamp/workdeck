import { invoke } from "@tauri-apps/api/core";

const localRelays = new Map<string, { channel: BroadcastChannel; peer: RTCPeerConnection }>();

export async function openStreamPopout(stream: MediaStream, title: string) {
  const sessionId = crypto.randomUUID();
  const channelName = `workdeck-stream-${sessionId}`;
  const channel = new BroadcastChannel(channelName);
  const peer = new RTCPeerConnection();
  const pendingIce: RTCIceCandidateInit[] = [];
  let offerStarted = false;
  localRelays.set(sessionId, { channel, peer });
  for (const track of stream.getTracks()) peer.addTrack(track, stream);
  peer.onicecandidate = ({ candidate }) => {
    if (candidate) channel.postMessage({ type: "candidate", candidate: candidate.toJSON() });
  };
  channel.onmessage = async ({ data }) => {
    if (data?.type === "ready") {
      if (offerStarted) return;
      offerStarted = true;
      await peer.setLocalDescription(await peer.createOffer());
      channel.postMessage({ type: "offer", description: peer.localDescription });
    } else if (data?.type === "answer") {
      await peer.setRemoteDescription(data.description);
      for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate).catch(() => undefined);
    } else if (data?.type === "candidate") {
      if (peer.remoteDescription) await peer.addIceCandidate(data.candidate).catch(() => undefined);
      else pendingIce.push(data.candidate);
    } else if (data?.type === "close") {
      peer.close();
      channel.close();
      localRelays.delete(sessionId);
    }
  };
  const query = `streamPopout=1&sessionId=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(title)}`;
  if ("__TAURI_INTERNALS__" in window) await invoke("open_stream_popout", { sessionId, title });
  else window.open(`${window.location.pathname}?${query}`, `workdeck-stream-${sessionId}`, "popup,width=960,height=560");
}
