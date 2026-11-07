import {
  db,
  getIdentity,
  saveIdentity,
  fingerprint,
  sign,
  verify,
  encode,
  decode,
  type Identity,
  type Contact,
  type ChatMessage,
} from './identity';
import {
  keyText,
  signalText,
  MAX_TEXT,
  MAX_FILE_SIZE,
  type Profile,
  type Signal,
} from '../shared/protocol';

export interface CallState {
  peer: string;
  id: string;
  phase: 'incoming' | 'outgoing' | 'connecting' | 'active';
  video: boolean;
  muted: boolean;
  camera: boolean;
  sharing: boolean;
  remoteCamera?: boolean;
  remoteSharing?: boolean;
  remoteMuted?: boolean;
  local?: MediaStream;
  remote?: MediaStream;
  started?: number;
}
export interface Snapshot {
  identity?: Identity;
  status: 'offline' | 'connecting' | 'online';
  contacts: Contact[];
  online: Set<string>;
  connected: Set<string>;
  messages: ChatMessage[];
  typing: Set<string>;
  call?: CallState;
  error?: string;
  server: string;
}
interface Transfer {
  message: ChatMessage;
  chunks: Uint8Array[];
  received: number;
  hash: string;
  timer: ReturnType<typeof setTimeout>;
}
interface Link {
  remoteIce: RTCIceCandidateInit[];
  localIce: RTCIceCandidateInit[];
  signaled: boolean;
  pc: RTCPeerConnection;
  session: string;
  channel?: RTCDataChannel;
  sending: boolean;
  transfers: Map<string, Transfer>;
  timer?: ReturnType<typeof setTimeout>;
}
const uid = () => crypto.randomUUID();
const sha = async (bytes: ArrayBuffer) => encode(await crypto.subtle.digest('SHA-256', bytes));
export class WindEngine {
  state: Snapshot = {
    status: 'offline',
    contacts: [],
    online: new Set(),
    connected: new Set(),
    messages: [],
    typing: new Set(),
    server: '',
  };
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private links = new Map<string, Link>();
  private ice: RTCIceServer[] = [];
  private reconnect?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private stopped = false;
  private serial = Promise.resolve();
  private seen = new Set<string>();
  private media?: RTCPeerConnection;
  private pendingCall?: RTCSessionDescriptionInit;
  private callIce: RTCIceCandidateInit[] = [];
  private localCallIce: RTCIceCandidateInit[] = [];
  private mediaSignaled = false;
  private callTimer?: ReturnType<typeof setTimeout>;
  private screen?: MediaStream;
  private cameraTrack?: MediaStreamTrack;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  private update(next: Partial<Snapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => fn());
  }
  report = (error: unknown) => {
    this.update({ error: error instanceof Error ? error.message : String(error) });
  };
  clearError = () => this.update({ error: undefined });
  async init() {
    try {
      if (!crypto.subtle)
        throw new Error('Wind needs HTTPS or localhost to protect your identity.');
      const store = await db;
      const identity = await getIdentity();
      const contacts = (await store.getAll('contacts')) as Contact[];
      const messages = ((await store.getAll('messages')) as ChatMessage[])
        .map((m) => (m.state === 'sending' ? { ...m, state: 'failed' as const } : m))
        .sort((a, b) => a.at - b.at);
      const server =
        (await store.get('settings', 'server')) ||
        import.meta.env.VITE_SIGNAL_URL ||
        location.origin;
      this.update({ identity, contacts, messages, server });
      if (identity.profile.name) this.connect();
      window.addEventListener('online', () => {
        if (this.state.status === 'offline' && !this.stopped) this.connect();
      });
    } catch (e) {
      this.report(e);
    }
  }
  async updateProfile(changes: Partial<Pick<Profile, 'name' | 'bio' | 'avatar' | 'color'>>) {
    const identity = {
      ...this.state.identity!,
      profile: { ...this.state.identity!.profile, ...changes },
    };
    identity.profile.name = identity.profile.name.trim().slice(0, 32);
    if (!identity.profile.name) throw new Error('Choose a display name first.');
    identity.profile.bio = identity.profile.bio.slice(0, 140);
    await saveIdentity(identity);
    this.update({ identity });
    if (this.state.status === 'online') {
      this.sendServer({ type: 'profile', profile: identity.profile });
      for (const c of this.state.contacts.filter((c) => c.accepted))
        void this.signal(c.id, { type: 'profile' });
    } else this.connect();
  }
  async setServer(value: string) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      throw new Error('Use an HTTPS server URL (HTTP is allowed on localhost).');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('Use the server origin only, such as https://wind.example.com.');
    await (await db).put('settings', url.origin, 'server');
    this.disconnect();
    this.stopped = false;
    this.update({ server: url.origin });
    this.connect();
  }
  private sendServer(value: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }
  connect() {
    if (
      (this.socket && this.socket.readyState < 2) ||
      !this.state.identity?.profile.name ||
      this.stopped
    )
      return;
    clearTimeout(this.reconnect);
    this.update({ status: 'connecting' });
    try {
      const base = new URL(this.state.server);
      if (!['http:', 'https:'].includes(base.protocol))
        throw new Error('Open Settings and enter your Wind server’s HTTPS URL.');
      const url = new URL('/signal', base);
      url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      this.socket = ws;
      // Fetch ICE configuration before handling offers.
      const config = fetch(new URL('/config', base))
        .then(async (r) => {
          if (!r.ok) throw new Error('ICE configuration unavailable');
          const c = await r.json();
          this.ice = c.iceServers || [];
        })
        .catch(() => {
          this.ice = [{ urls: 'stun:stun.l.google.com:19302' }];
        });
      ws.onmessage = (e) => {
        this.serial = this.serial
          .then(async () => {
            if (this.socket !== ws) return;
            const m = JSON.parse(e.data);
            if (m.type === 'challenge') {
              await config;
              this.sendServer({
                type: 'register',
                profile: this.state.identity!.profile,
                signature: await sign(this.state.identity!, m.challenge),
              });
            } else if (m.type === 'ready') {
              this.reconnectAttempt = 0;
              this.update({ status: 'online' });
              this.watch();
              for (const c of this.state.contacts.filter((c) => c.pending === 'outgoing'))
                await this.signal(c.id, { type: 'friend-request' });
            } else if (m.type === 'presence') {
              const online = new Set(this.state.online);
              if (m.online) online.add(m.id);
              else {
                online.delete(m.id);
                this.closeLink(m.id);
              }
              this.update({ online });
              if (m.online) {
                const contact = this.contact(m.id);
                if (contact?.accepted) {
                  // Reconcile a previously accepted request if the acknowledgement was lost.
                  await this.signal(m.id, { type: 'friend-accept' });
                  if (this.me < m.id) await this.openLink(m.id);
                } else if (contact?.pending === 'outgoing')
                  await this.signal(m.id, { type: 'friend-request' });
              }
            } else if (m.type === 'signal') await this.receiveSignal(m.profile, m.signal);
            else if (m.type === 'unavailable') {
              if (this.state.call?.peer === m.id && this.state.call?.phase !== 'active')
                this.finishCall('Your friend is offline. Try again when they’re back.');
            }
          })
          .catch(this.report);
      };
      ws.onclose = (e) => {
        if (this.socket !== ws) return;
        this.socket = undefined;
        this.update({ status: 'offline', online: new Set() });
        if (e.code === 4009) {
          this.stopped = true;
          this.report('Wind is open in another tab. Close it there and reload here.');
          return;
        }
        if (e.code === 4003 || e.code === 4008) {
          this.stopped = true;
          this.report(`Connection rejected: ${e.reason}. Reload to reconnect.`);
          return;
        }
        if (!this.stopped)
          this.reconnect = setTimeout(
            () => this.connect(),
            Math.min(30000, 1000 * 2 ** this.reconnectAttempt++),
          );
      };
      ws.onerror = () => {}; // onclose handles retry without repeated toast notifications.
    } catch (e) {
      this.update({ status: 'offline' });
      this.report(e);
    }
  }
  disconnect() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = undefined;
    for (const id of this.links.keys()) this.closeLink(id);
    this.finishCall();
    this.update({ status: 'offline', online: new Set() });
  }
  get me() {
    return this.state.identity!.profile.id;
  }
  contact(id: string) {
    return this.state.contacts.find((c) => c.id === id);
  }
  private watch() {
    this.sendServer({ type: 'watch', ids: this.state.contacts.map((c) => c.id) });
  }
  private async saveContact(contact: Contact) {
    await (await db).put('contacts', contact);
    this.update({ contacts: [...this.state.contacts.filter((c) => c.id !== contact.id), contact] });
    this.watch();
  }
  async addFriend(profile: Profile) {
    if (this.state.contacts.length >= 200 && !this.contact(profile.id))
      throw new Error('Wind supports up to 200 friends on this device.');
    if (profile.id === this.me)
      throw new Error('That’s your invite! Ask your friend to share theirs.');
    if (this.contact(profile.id)?.accepted) throw new Error('You’re already friends.');
    const existing = this.contact(profile.id);
    if (existing?.pending === 'incoming') return this.acceptFriend(profile.id);
    await this.saveContact({ ...profile, accepted: false, pending: 'outgoing' });
    if (this.state.status === 'online') await this.signal(profile.id, { type: 'friend-request' });
  }
  async acceptFriend(id: string) {
    const contact = this.contact(id);
    if (!contact) return;
    await this.saveContact({ ...contact, accepted: true, pending: undefined });
    await this.signal(id, { type: 'friend-accept' });
    if (this.me < id && this.state.online.has(id)) await this.openLink(id);
  }
  async removeFriend(id: string, notify = true) {
    if (notify && this.state.status === 'online') await this.signal(id, { type: 'friend-remove' });
    this.closeLink(id);
    if (this.state.call?.peer === id) this.endCall();
    await (await db).delete('contacts', id);
    this.update({ contacts: this.state.contacts.filter((c) => c.id !== id) });
    this.watch();
  }
  async markVerified(id: string) {
    const c = this.contact(id);
    if (c) await this.saveContact({ ...c, verified: !c.verified });
  }
  async signal(to: string, body: Signal['body']) {
    if (this.state.status !== 'online')
      throw new Error('The signaling server is disconnected. Wait for reconnection.');
    const payload = {
      id: uid(),
      from: this.me,
      to,
      at: Date.now(),
      body: { ...body, profile: this.state.identity!.profile },
    };
    const signature = await sign(this.state.identity!, signalText(payload));
    this.sendServer({ type: 'signal', signal: { ...payload, signature } });
  }
  private async receiveSignal(_untrustedProfile: Profile, signal: Signal) {
    const profile = signal?.body?.profile as Profile;
    if (!signal || !profile) return;
    if (signal.to !== this.me || this.seen.has(signal.id) || !(await verify(profile, signal)))
      return;
    this.seen.add(signal.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    const existing = this.contact(profile.id);
    if (existing && keyText(existing.key) !== keyText(profile.key))
      throw new Error('Identity key changed. Connection blocked.');
    const b = signal.body,
      id = profile.id;
    if (b.type === 'friend-request') {
      if (!existing && this.state.contacts.length < 200)
        await this.saveContact({ ...profile, accepted: false, pending: 'incoming' });
      else if (existing?.accepted) await this.signal(id, { type: 'friend-accept' });
      return;
    }
    if (!existing) return;
    if (b.type === 'friend-remove') {
      await this.removeFriend(id, false);
      return;
    }
    if (b.type === 'friend-accept') {
      if (!existing.accepted && existing.pending !== 'outgoing') return;
      if (!existing.accepted)
        await this.saveContact({ ...existing, ...profile, accepted: true, pending: undefined });
      if (this.me < id) await this.openLink(id);
      return;
    }
    if (!existing.accepted) return;
    if (b.type === 'profile') {
      await this.saveContact({ ...existing, ...profile });
      return;
    }
    if (b.type === 'data-offer' && typeof b.session === 'string' && id < this.me && b.description) {
      if (this.links.get(id)?.session === b.session) return;
      this.closeLink(id);
      const link = this.createLink(id, b.session);
      await link.pc.setRemoteDescription(b.description as RTCSessionDescriptionInit);
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      await this.sendLinkDescription(id, link, 'data-answer');
    } else if (b.type === 'data-answer' && this.links.get(id)?.session === b.session) {
      const link = this.links.get(id)!;
      if (link.pc.signalingState === 'have-local-offer') {
        await link.pc.setRemoteDescription(b.description as RTCSessionDescriptionInit);
        for (const candidate of link.remoteIce) await link.pc.addIceCandidate(candidate);
        link.remoteIce = [];
      }
    } else if (b.type === 'data-ice' && this.links.get(id)?.session === b.session && b.candidate) {
      const link = this.links.get(id)!;
      if (link.pc.remoteDescription)
        await link.pc.addIceCandidate(b.candidate as RTCIceCandidateInit);
      else if (link.remoteIce.length < 100) link.remoteIce.push(b.candidate as RTCIceCandidateInit);
    } else if (b.type === 'call-offer' && typeof b.callId === 'string' && b.description) {
      if (this.state.call) {
        await this.signal(id, { type: 'call-end', callId: b.callId, reason: 'busy' });
        return;
      }
      this.pendingCall = b.description as RTCSessionDescriptionInit;
      this.callIce = [];
      this.update({
        call: {
          peer: id,
          id: b.callId,
          phase: 'incoming',
          video: b.video === true,
          remoteCamera: b.video === true,
          muted: false,
          camera: false,
          sharing: false,
        },
      });
      this.callTimer = setTimeout(() => this.endCall(), 45000);
    } else if (this.state.call?.peer === id && this.state.call.id === b.callId) {
      if (b.type === 'call-answer' && this.media?.signalingState === 'have-local-offer') {
        await this.media.setRemoteDescription(b.description as RTCSessionDescriptionInit);
        for (const c of this.callIce) await this.media.addIceCandidate(c);
        this.callIce = [];
      } else if (b.type === 'call-ice' && b.candidate) {
        if (this.media?.remoteDescription)
          await this.media.addIceCandidate(b.candidate as RTCIceCandidateInit);
        else if (this.callIce.length < 100) this.callIce.push(b.candidate as RTCIceCandidateInit);
      } else if (b.type === 'call-state')
        this.setCall({
          remoteCamera: b.camera === true,
          remoteSharing: b.sharing === true,
          remoteMuted: b.muted === true,
        });
      else if (b.type === 'call-end')
        this.finishCall(b.reason === 'busy' ? 'Your friend is in another call.' : undefined);
    }
  }
  private createLink(id: string, session: string) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const link: Link = {
      pc,
      session,
      sending: false,
      transfers: new Map(),
      remoteIce: [],
      localIce: [],
      signaled: false,
    };
    this.links.set(id, link);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (link.signaled)
        void this.signal(id, { type: 'data-ice', session, candidate: e.candidate.toJSON() }).catch(
          this.report,
        );
      else link.localIce.push(e.candidate.toJSON());
    };
    pc.ondatachannel = (e) => this.attachChannel(id, link, e.channel);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState) && this.links.get(id) === link) {
        this.closeLink(id);
        if (this.state.online.has(id) && this.me < id)
          setTimeout(() => {
            if (!this.stopped) void this.openLink(id).catch(this.report);
          }, 2500);
      }
    };
    link.timer = setTimeout(() => {
      if (this.links.get(id) === link && link.channel?.readyState !== 'open') {
        this.closeLink(id);
        this.report(
          'Couldn’t connect to your friend. Check your network or configure a TURN relay.',
        );
      }
    }, 25000);
    return link;
  }
  private async openLink(id: string) {
    if (this.links.has(id) || !this.contact(id)?.accepted) return;
    const link = this.createLink(id, uid());
    this.attachChannel(id, link, link.pc.createDataChannel('wind', { ordered: true }));
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await this.sendLinkDescription(id, link, 'data-offer');
  }
  private async sendLinkDescription(id: string, link: Link, type: string) {
    await this.signal(id, { type, session: link.session, description: link.pc.localDescription });
    link.signaled = true;
    for (const candidate of link.localIce)
      await this.signal(id, { type: 'data-ice', session: link.session, candidate });
    link.localIce = [];
  }
  reconnectPeer(id: string) {
    if (!this.state.online.has(id))
      return this.report('Your friend needs to be online to connect.');
    this.closeLink(id);
    if (this.me < id) void this.openLink(id).catch(this.report);
    else void this.signal(id, { type: 'friend-accept' }).catch(this.report);
  }
  private attachChannel(id: string, link: Link, channel: RTCDataChannel) {
    link.channel = channel;
    channel.bufferedAmountLowThreshold = 65536;
    channel.onopen = () => {
      clearTimeout(link.timer);
      const connected = new Set(this.state.connected);
      connected.add(id);
      this.update({ connected });
    };
    let queue = Promise.resolve();
    channel.onmessage = (e) => {
      queue = queue.then(() => this.receiveData(id, link, JSON.parse(e.data))).catch(this.report);
    };
    channel.onclose = () => {
      if (this.links.get(id) === link) this.closeLink(id);
    };
    channel.onerror = () => {};
  }
  private closeLink(id: string) {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    clearTimeout(link.timer);
    for (const transfer of link.transfers.values()) clearTimeout(transfer.timer);
    link.channel?.close();
    link.pc.close();
    const connected = new Set(this.state.connected);
    connected.delete(id);
    this.update({ connected });
    for (const m of this.state.messages.filter((m) => m.peer === id && m.state === 'sending'))
      void this.messageState(m.id, 'failed');
  }
  private channel(id: string) {
    const channel = this.links.get(id)?.channel;
    if (channel?.readyState !== 'open')
      throw new Error('Your friend must be connected before you can send a message.');
    return channel;
  }
  private async putMessage(message: ChatMessage) {
    await (await db).put('messages', message);
    const messages = [...this.state.messages.filter((m) => m.id !== message.id), message].sort(
      (a, b) => a.at - b.at,
    );
    this.update({ messages });
  }
  private async messageState(id: string, state: ChatMessage['state']) {
    const message = this.state.messages.find((m) => m.id === id);
    if (message) await this.putMessage({ ...message, state });
  }
  async sendText(peer: string, text: string) {
    text = text.trim();
    if (!text || text.length > MAX_TEXT)
      throw new Error(`Messages can contain up to ${MAX_TEXT.toLocaleString()} characters.`);
    const channel = this.channel(peer);
    const message: ChatMessage = {
      id: uid(),
      peer,
      from: this.me,
      text,
      at: Date.now(),
      state: 'sending',
    };
    await this.putMessage(message);
    try {
      channel.send(JSON.stringify({ type: 'text', id: message.id, text, at: message.at }));
      this.ackTimeout(message.id);
    } catch (e) {
      await this.messageState(message.id, 'failed');
      throw e;
    }
  }
  private ackTimeout(id: string) {
    setTimeout(() => {
      if (this.state.messages.find((m) => m.id === id)?.state === 'sending')
        void this.messageState(id, 'failed');
    }, 20000);
  }
  typing(peer: string, active: boolean) {
    try {
      this.channel(peer).send(JSON.stringify({ type: 'typing', active }));
    } catch {
      /* no typing while disconnected */
    }
  }
  async sendFile(peer: string, file: File) {
    if (!file.size || file.size > MAX_FILE_SIZE)
      throw new Error('Choose a file between 1 byte and 25 MB.');
    const channel = this.channel(peer),
      link = this.links.get(peer)!;
    if (link.sending) throw new Error('Wait for the current attachment to finish.');
    link.sending = true;
    const message: ChatMessage = {
      id: uid(),
      peer,
      from: this.me,
      text: '',
      at: Date.now(),
      state: 'sending',
      file: { name: file.name.slice(0, 255), type: file.type, size: file.size, blob: file },
    };
    try {
      await this.putMessage(message);
      const bytes = await file.arrayBuffer();
      channel.send(
        JSON.stringify({
          type: 'file-start',
          id: message.id,
          at: message.at,
          name: message.file!.name,
          mime: file.type,
          size: file.size,
          hash: await sha(bytes),
        }),
      );
      for (let offset = 0; offset < bytes.byteLength; offset += 12000) {
        if (channel.bufferedAmount > 256000)
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timeout);
              channel.removeEventListener('bufferedamountlow', ready);
              channel.removeEventListener('close', closed);
            };
            const ready = () => {
              cleanup();
              resolve();
            };
            const closed = () => {
              cleanup();
              reject(new Error('File transfer interrupted.'));
            };
            const timeout = setTimeout(closed, 15000);
            channel.addEventListener('bufferedamountlow', ready, { once: true });
            channel.addEventListener('close', closed, { once: true });
          });
        channel.send(
          JSON.stringify({
            type: 'file-chunk',
            id: message.id,
            data: encode(bytes.slice(offset, offset + 12000)),
          }),
        );
      }
      channel.send(JSON.stringify({ type: 'file-end', id: message.id }));
      this.ackTimeout(message.id);
    } catch (e) {
      await this.messageState(message.id, 'failed');
      throw e;
    } finally {
      link.sending = false;
    }
  }
  private async receiveData(peer: string, link: Link, m: Record<string, any>) {
    if (!m || typeof m !== 'object') return;
    const channel = link.channel!;
    if (m.type === 'typing') {
      clearTimeout(this.typingTimers.get(peer));
      const typing = new Set(this.state.typing);
      if (m.active === true) typing.add(peer);
      else typing.delete(peer);
      this.update({ typing });
      this.typingTimers.set(
        peer,
        setTimeout(() => {
          const typing = new Set(this.state.typing);
          typing.delete(peer);
          this.update({ typing });
        }, 3000),
      );
      return;
    }
    if (typeof m.id !== 'string' || !/^[a-f0-9-]{36}$/.test(m.id)) return;
    if (m.type === 'ack') {
      const existing = this.state.messages.find((message) => message.id === m.id);
      if (existing?.peer === peer && existing.from === this.me)
        await this.messageState(m.id, 'delivered');
      return;
    }
    const existing = this.state.messages.find((message) => message.id === m.id);
    if (existing) {
      if (existing.peer === peer && existing.from === peer)
        channel.send(JSON.stringify({ type: 'ack', id: m.id }));
      return;
    }
    if (
      m.type === 'text' &&
      typeof m.text === 'string' &&
      m.text.length > 0 &&
      m.text.length <= MAX_TEXT
    ) {
      await this.putMessage({
        id: m.id,
        peer,
        from: peer,
        text: m.text,
        at: Date.now(),
        state: 'received',
      });
      channel.send(JSON.stringify({ type: 'ack', id: m.id }));
    } else if (
      m.type === 'file-start' &&
      Number.isInteger(m.size) &&
      m.size > 0 &&
      m.size <= MAX_FILE_SIZE &&
      typeof m.name === 'string' &&
      m.name.length <= 255 &&
      typeof m.mime === 'string' &&
      m.mime.length <= 100 &&
      typeof m.hash === 'string' &&
      m.hash.length === 43 &&
      !link.transfers.size
    ) {
      const transfer: Transfer = {
        message: {
          id: m.id,
          peer,
          from: peer,
          text: '',
          at: Date.now(),
          state: 'received',
          file: { name: m.name, type: m.mime, size: m.size, blob: new Blob() },
        },
        received: 0,
        chunks: [],
        hash: m.hash,
        timer: setTimeout(() => link.transfers.delete(m.id), 120000),
      };
      link.transfers.set(m.id, transfer);
    } else if (m.type === 'file-chunk' && typeof m.data === 'string' && m.data.length <= 16000) {
      const transfer = link.transfers.get(m.id);
      if (!transfer) return;
      const bytes = decode(m.data);
      transfer.received += bytes.byteLength;
      if (transfer.received > transfer.message.file!.size) {
        clearTimeout(transfer.timer);
        link.transfers.delete(m.id);
        return;
      }
      transfer.chunks.push(bytes);
    } else if (m.type === 'file-end') {
      const transfer = link.transfers.get(m.id);
      if (!transfer) return;
      clearTimeout(transfer.timer);
      link.transfers.delete(m.id);
      const blob = new Blob(transfer.chunks as BlobPart[], { type: transfer.message.file!.type });
      if (
        blob.size !== transfer.message.file!.size ||
        (await sha(await blob.arrayBuffer())) !== transfer.hash
      )
        throw new Error('The attachment was interrupted. Ask your friend to resend it.');
      await this.putMessage({ ...transfer.message, file: { ...transfer.message.file!, blob } });
      channel.send(JSON.stringify({ type: 'ack', id: m.id }));
    }
  }
  async clearHistory(peer: string) {
    const store = await db,
      tx = store.transaction('messages', 'readwrite');
    for (const m of this.state.messages.filter((m) => m.peer === peer)) await tx.store.delete(m.id);
    await tx.done;
    this.update({ messages: this.state.messages.filter((m) => m.peer !== peer) });
  }
  private setCall(changes: Partial<CallState>) {
    if (this.state.call) this.update({ call: { ...this.state.call, ...changes } });
  }
  private createMedia(call: CallState) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    this.media = pc;
    this.localCallIce = [];
    this.mediaSignaled = false;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (this.mediaSignaled)
        void this.signal(call.peer, {
          type: 'call-ice',
          callId: call.id,
          candidate: e.candidate.toJSON(),
        }).catch(this.report);
      else this.localCallIce.push(e.candidate.toJSON());
    };
    const remote = new MediaStream();
    this.setCall({ remote });
    pc.ontrack = (e) => {
      remote.addTrack(e.track);
      this.setCall({ remote: new MediaStream(remote.getTracks()) });
    };
    pc.onconnectionstatechange = () => {
      if (this.media !== pc) return;
      if (pc.connectionState === 'connected') {
        clearTimeout(this.callTimer);
        this.setCall({ phase: 'active', started: this.state.call?.started || Date.now() });
      }
      if (['failed', 'closed'].includes(pc.connectionState))
        this.finishCall(
          pc.connectionState === 'failed' ? 'The call connection was lost.' : undefined,
        );
    };
    return pc;
  }
  private async getMedia(video: boolean) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Microphone access requires HTTPS and a supported browser.');
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
  }
  async startCall(peer: string, video: boolean) {
    if (this.state.call) throw new Error('End your current call first.');
    if (!this.state.online.has(peer))
      throw new Error('Your friend needs to be online to receive a call.');
    const call: CallState = {
      peer,
      id: uid(),
      phase: 'outgoing',
      video,
      remoteCamera: video,
      muted: false,
      camera: video,
      sharing: false,
    };
    this.update({ call });
    try {
      const local = await this.getMedia(video);
      if (this.getSnapshot().call?.id !== call.id) {
        local.getTracks().forEach((t) => t.stop());
        return;
      }
      this.setCall({ local });
      this.cameraTrack = local.getVideoTracks()[0];
      const pc = this.createMedia(call);
      local.getAudioTracks().forEach((t) => pc.addTrack(t, local));
      pc.addTransceiver('video', { direction: 'sendrecv', streams: [local] });
      if (this.cameraTrack)
        await pc
          .getTransceivers()
          .find((t) => t.receiver.track.kind === 'video')!
          .sender.replaceTrack(this.cameraTrack);
      await pc.setLocalDescription(await pc.createOffer());
      await this.sendCallDescription(call, {
        type: 'call-offer',
        video,
        description: pc.localDescription,
      });
      this.callTimer = setTimeout(() => {
        this.endCall();
        this.report('No answer. Try calling again later.');
      }, 45000);
    } catch (e) {
      this.finishCall();
      throw e;
    }
  }
  private async sendCallDescription(call: CallState, body: Signal['body']) {
    await this.signal(call.peer, { ...body, callId: call.id });
    this.mediaSignaled = true;
    for (const candidate of this.localCallIce)
      await this.signal(call.peer, { type: 'call-ice', callId: call.id, candidate });
    this.localCallIce = [];
  }
  async answerCall() {
    const call = this.state.call,
      offer = this.pendingCall;
    if (!call || !offer || call.phase !== 'incoming') return;
    clearTimeout(this.callTimer);
    this.setCall({ phase: 'connecting' });
    try {
      const local = await this.getMedia(call.video);
      if (this.getSnapshot().call?.id !== call.id) {
        local.getTracks().forEach((t) => t.stop());
        return;
      }
      this.setCall({ local, camera: call.video });
      this.cameraTrack = local.getVideoTracks()[0];
      const pc = this.createMedia(call);
      await pc.setRemoteDescription(offer);
      local.getTracks().forEach((t) => pc.addTrack(t, local));
      for (const candidate of this.callIce) await pc.addIceCandidate(candidate);
      this.callIce = [];
      await pc.setLocalDescription(await pc.createAnswer());
      await this.sendCallDescription(call, {
        type: 'call-answer',
        description: pc.localDescription,
      });
      this.callTimer = setTimeout(() => {
        this.endCall();
        this.report('The call could not connect. Check your network or TURN relay.');
      }, 30000);
    } catch (e) {
      this.endCall();
      throw e;
    }
  }
  private broadcastCallState() {
    const call = this.state.call;
    if (call && this.state.status === 'online')
      void this.signal(call.peer, {
        type: 'call-state',
        callId: call.id,
        camera: call.camera,
        sharing: call.sharing,
        muted: call.muted,
      }).catch(this.report);
  }
  toggleMute() {
    const call = this.state.call;
    if (!call?.local) return;
    call.local.getAudioTracks().forEach((t) => {
      t.enabled = call.muted;
    });
    this.setCall({ muted: !call.muted });
    this.broadcastCallState();
  }
  async toggleCamera() {
    const call = this.state.call;
    if (!call?.local || !this.media) return;
    if (call.sharing) await this.stopSharing();
    if (call.camera) {
      if (this.cameraTrack) this.cameraTrack.enabled = false;
      this.setCall({ camera: false });
      this.broadcastCallState();
      return;
    }
    if (!this.cameraTrack || this.cameraTrack.readyState === 'ended') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (this.getSnapshot().call?.id !== call.id) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.cameraTrack = stream.getVideoTracks()[0];
      call.local.addTrack(this.cameraTrack);
    }
    this.cameraTrack.enabled = true;
    const sender =
      this.media!.getSenders().find((s) => s.track?.kind === 'video') ||
      this.media!.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
    if (sender) await sender.replaceTrack(this.cameraTrack);
    this.setCall({ camera: true, local: new MediaStream(call.local.getTracks()) });
    this.broadcastCallState();
  }
  async shareScreen() {
    const call = this.state.call;
    if (!call || !this.media || !call.local) return;
    if (call.sharing) return this.stopSharing();
    if (!navigator.mediaDevices.getDisplayMedia)
      throw new Error(
        'Screen sharing isn’t available on this device. You can still view a friend’s shared screen.',
      );
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (this.getSnapshot().call?.id !== call.id) {
      screen.getTracks().forEach((t) => t.stop());
      return;
    }
    this.screen = screen;
    const sender =
      this.media!.getSenders().find((s) => s.track?.kind === 'video') ||
      this.media!.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
    if (!sender) {
      screen.getTracks().forEach((t) => t.stop());
      throw new Error('No video connection is available. Restart the call.');
    }
    await sender.replaceTrack(screen.getVideoTracks()[0]);
    screen.getVideoTracks()[0].onended = () => {
      void this.stopSharing();
    };
    this.setCall({
      sharing: true,
      local: new MediaStream([...call.local.getAudioTracks(), ...screen.getVideoTracks()]),
    });
    this.broadcastCallState();
  }
  private async stopSharing() {
    this.screen?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.screen = undefined;
    const sender = this.media?.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(this.cameraTrack || null);
    const local = new MediaStream([
      ...(this.state.call?.local?.getAudioTracks() || []),
      ...(this.cameraTrack ? [this.cameraTrack] : []),
    ]);
    this.setCall({ sharing: false, local });
    this.broadcastCallState();
  }
  endCall() {
    const call = this.state.call;
    if (call && this.state.status === 'online')
      void this.signal(call.peer, { type: 'call-end', callId: call.id }).catch(() => {});
    this.finishCall();
  }
  private finishCall(error?: string) {
    clearTimeout(this.callTimer);
    const pc = this.media;
    this.media = undefined;
    pc?.close();
    this.state.call?.local?.getTracks().forEach((t) => t.stop());
    this.cameraTrack?.stop();
    this.cameraTrack = undefined;
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = undefined;
    this.pendingCall = undefined;
    this.callIce = [];
    this.update({ call: undefined, ...(error ? { error } : {}) });
  }
}
export const engine = new WindEngine();
export const identityFingerprint = (profile: Profile) => fingerprint(profile.key);
