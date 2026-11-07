import {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Wind,
  Plus,
  Search,
  MessageCircle,
  Users,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Copy,
  Check,
  X,
  ShieldCheck,
  LockKeyhole,
  Phone,
  Video,
  Mic,
  MicOff,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Smile,
  Send,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  CheckCheck,
  Link,
  Globe,
  Heart,
  Volume2,
  UserPlus,
  Trash2,
  LoaderCircle,
  CircleHelp,
  WifiOff,
} from 'lucide-react';
import { engine, identityFingerprint } from './engine';
import { inviteCode, parseInvite, type Contact, type ChatMessage } from './identity';
import type { Profile } from '../shared/protocol';
import { Attachment, MessageText, Stream } from './media';

let initialized = false;
type Modal =
  'invite' | 'add' | 'settings' | 'profile' | 'verify' | 'help' | 'clear' | 'remove' | null;
export function Avatar({
  profile,
  size = 40,
  online,
  className = '',
}: {
  profile: Pick<Profile, 'name' | 'color' | 'avatar'>;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: profile.color + '20',
        color: profile.color,
        fontSize: size * 0.36,
      }}
    >
      {profile.avatar ? (
        <img src={profile.avatar} alt={`${profile.name}’s avatar`} />
      ) : (
        <span>{profile.name.trim().slice(0, 2).toUpperCase() || 'W'}</span>
      )}
      {online !== undefined && <i className={online ? 'online' : ''} />}
    </span>
  );
}
function IconButton({
  label,
  children,
  onClick,
  className = '',
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function App() {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [modal, setModal] = useState<Modal>(null);
  const [page, setPage] = useState<'inbox' | 'friends'>('inbox');
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'requests'>('all');
  const [copied, setCopied] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [menu, setMenu] = useState(false);
  const openedAt = useRef(Date.now());
  const [seen, setSeen] = useState<Record<string, number>>({});
  const peer = state.contacts.find((c) => c.id === selected);
  const accepted = state.contacts.filter((c) => c.accepted);
  const requests = state.contacts.filter((c) => !c.accepted);
  const incoming = requests.filter((c) => c.pending === 'incoming');
  const me = state.identity?.profile;
  useEffect(() => {
    if (!initialized) {
      initialized = true;
      void engine.init();
    }
  }, []);
  useEffect(() => {
    if (state.error) {
      const timer = setTimeout(engine.clearError, 9000);
      return () => clearTimeout(timer);
    }
  }, [state.error]);
  useEffect(() => {
    if (selected) setSeen((s) => ({ ...s, [selected]: Date.now() }));
  }, [selected, state.messages.length]);
  useEffect(() => {
    if (modal === 'verify' && peer) void identityFingerprint(peer).then(setFingerprint);
  }, [modal, peer]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModal(null);
        setMenu(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  const run = (promise: Promise<unknown>) => {
    void promise.catch(engine.report);
  };
  const openChat = (id: string) => {
    setSelected(id);
    setPage('inbox');
    setMenu(false);
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode(me!));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      engine.report('Clipboard unavailable. Select and copy the invite text below.');
    }
  };
  if (!me)
    return (
      <div className="loading">
        <Wind size={42} />
        <p>{state.error || 'A breath of fresh air…'}</p>
      </div>
    );
  const countOnline = accepted.filter((c) => state.online.has(c.id)).length;
  const unread = (id: string) =>
    state.messages.filter(
      (m) =>
        m.peer === id && m.from === id && m.at > (seen[id] || openedAt.current) && selected !== id,
    ).length;
  return (
    <div className={`app ${selected ? 'chat-open' : ''}`}>
      <aside className="rail">
        <button
          className="brand-mark"
          aria-label="Wind home"
          onClick={() => {
            setSelected(undefined);
            setPage('inbox');
          }}
        >
          <Wind size={29} strokeWidth={2.2} />
        </button>
        <span className="rail-divider" />
        <IconButton
          label="Inbox"
          className={page === 'inbox' ? 'active' : ''}
          onClick={() => {
            setPage('inbox');
            setSelected(undefined);
          }}
        >
          <MessageCircle size={23} />
        </IconButton>
        <div className="rail-badge">
          <IconButton
            label="Friends"
            className={page === 'friends' ? 'active' : ''}
            onClick={() => {
              setPage('friends');
              setSelected(undefined);
            }}
          >
            <Users size={23} />
          </IconButton>
          {incoming.length > 0 && <b>{incoming.length}</b>}
        </div>
        <IconButton label="Add a friend" className="rail-add" onClick={() => setModal('add')}>
          <Plus size={24} />
        </IconButton>
        <div className="rail-bottom">
          <IconButton label="About Wind" onClick={() => setModal('help')}>
            <CircleHelp size={21} />
          </IconButton>
          <button
            className="self-avatar"
            aria-label="Edit profile"
            onClick={() => setModal('profile')}
          >
            <Avatar profile={me} size={37} />
          </button>
        </div>
      </aside>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span>
            wind<span className="brand-dot">.</span>
          </span>
          <span className="beta">EARLY ACCESS</span>
        </div>
        <div className="sidebar-heading">
          <h2>Your space</h2>
          <IconButton label="Start a conversation" onClick={() => setModal('add')}>
            <Plus size={18} />
          </IconButton>
        </div>
        <label className="search">
          <Search size={16} />
          <input
            placeholder="Find a conversation"
            aria-label="Find a conversation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌕</kbd>
        </label>
        <button
          className={`sidebar-home ${!selected ? 'selected' : ''}`}
          onClick={() => setSelected(undefined)}
        >
          <Users size={18} />
          <span>Friends</span>
          <span className="count">{accepted.length}</span>
        </button>
        <div className="section-label">
          DIRECT MESSAGES{' '}
          <button aria-label="Add friend" onClick={() => setModal('add')}>
            <Plus size={15} />
          </button>
        </div>
        <div className="conversation-list">
          {accepted
            .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
            .map((c) => {
              const last = state.messages.filter((m) => m.peer === c.id).at(-1);
              const n = unread(c.id);
              return (
                <button
                  key={c.id}
                  className={`conversation ${selected === c.id ? 'selected' : ''}`}
                  onClick={() => openChat(c.id)}
                >
                  <Avatar profile={c} online={state.online.has(c.id)} />
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {state.typing.has(c.id)
                        ? 'Typing…'
                        : last?.file
                          ? '↳ ' + last.file.name
                          : last?.text || 'Say something nice'}
                    </small>
                  </span>
                  {n > 0 && <b className="unread">{n}</b>}
                </button>
              );
            })}
          {!accepted.length && (
            <div className="sidebar-empty">
              <span className="dashed-icon">
                <MessageCircle size={20} />
              </span>
              <p>
                Good conversations
                <br />
                start with your people.
              </p>
              <button onClick={() => setModal('add')}>
                Find a friend <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {accepted.length > 0 &&
            !accepted.some((c) => c.name.toLowerCase().includes(search.toLowerCase())) && (
              <p className="muted no-results">No conversations found.</p>
            )}
        </div>
        <div className="invite-card">
          <span className="mini-spark">✳</span>
          <strong>Better with your people.</strong>
          <p>
            A private little corner
            <br />
            of the internet, together.
          </p>
          <button onClick={() => setModal('invite')}>
            Invite a friend <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="self-bar">
          <button onClick={() => setModal('profile')}>
            <Avatar profile={me} size={35} online={state.status === 'online'} />
            <span>
              <strong>{me.name || 'Your profile'}</strong>
              <small>
                {state.status === 'online'
                  ? 'Online & feeling breezy'
                  : state.status === 'connecting'
                    ? 'Connecting…'
                    : 'Offline'}
              </small>
            </span>
          </button>
          <IconButton label="Settings" onClick={() => setModal('settings')}>
            <Settings size={18} />
          </IconButton>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            {peer ? (
              <>
                <IconButton
                  label="Back to conversations"
                  className="mobile-back"
                  onClick={() => setSelected(undefined)}
                >
                  <ChevronLeft size={22} />
                </IconButton>
                <Avatar profile={peer} size={32} online={state.online.has(peer.id)} />
                <span>
                  <strong>{peer.name}</strong>
                  <small>
                    {state.connected.has(peer.id)
                      ? 'Encrypted peer connection'
                      : state.online.has(peer.id)
                        ? 'Connecting directly…'
                        : 'Offline'}
                  </small>
                </span>
              </>
            ) : (
              <>
                <span className="topbar-icon">
                  {page === 'friends' ? <Users size={21} /> : <MessageCircle size={21} />}
                </span>
                <strong>{page === 'friends' ? 'Friends' : 'Inbox'}</strong>
                <span className="header-separator" />
                <span className="topbar-subtitle">A place for your people</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {peer ? (
              <>
                <IconButton
                  label="Start voice call"
                  disabled={!state.online.has(peer.id) || !!state.call}
                  onClick={() => run(engine.startCall(peer.id, false))}
                >
                  <Phone size={20} />
                </IconButton>
                <IconButton
                  label="Start video call"
                  disabled={!state.online.has(peer.id) || !!state.call}
                  onClick={() => run(engine.startCall(peer.id, true))}
                >
                  <Video size={22} />
                </IconButton>
                <span className="header-separator" />
                <div className="menu-wrap">
                  <IconButton label="Conversation options" onClick={() => setMenu(!menu)}>
                    <MoreHorizontal size={22} />
                  </IconButton>
                  {menu && (
                    <div className="dropdown">
                      <button
                        onClick={() => {
                          setModal('verify');
                          setMenu(false);
                        }}
                      >
                        <ShieldCheck size={16} />
                        Verify identity
                      </button>
                      <button
                        onClick={() => {
                          engine.reconnectPeer(peer.id);
                          setMenu(false);
                        }}
                      >
                        <Link size={16} />
                        Reconnect
                      </button>
                      <button
                        onClick={() => {
                          setModal('clear');
                          setMenu(false);
                        }}
                      >
                        <Trash2 size={16} />
                        Clear local history
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => {
                          setModal('remove');
                          setMenu(false);
                        }}
                      >
                        <X size={16} />
                        Remove friend
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="privacy-badge">
                  <LockKeyhole size={13} />
                  End-to-end encrypted
                </span>
                <IconButton label="Help" onClick={() => setModal('help')}>
                  <CircleHelp size={20} />
                </IconButton>
              </>
            )}
          </div>
        </header>
        {state.status !== 'online' && (
          <div className="connection-banner">
            <WifiOff size={14} />
            {state.status === 'connecting'
              ? 'Connecting to your Wind server…'
              : 'Signaling is offline. Existing peer connections may still work.'}
            <button onClick={() => setModal('settings')}>
              Server settings <ArrowRight size={13} />
            </button>
          </div>
        )}
        {peer ? (
          <Chat
            peer={peer}
            messages={state.messages.filter((m) => m.peer === peer.id)}
            connected={state.connected.has(peer.id)}
            me={me}
            typing={state.typing.has(peer.id)}
            run={run}
            onInvite={() => setModal('invite')}
          />
        ) : (
          <div className="home-scroll">
            <div className="home-content">
              <section className="greeting">
                <div>
                  <div className="eyebrow">
                    <span className="tiny-dot" />
                    YOUR LITTLE CORNER OF THE INTERNET
                  </div>
                  <h1>
                    Your people,
                    <br />
                    <span>a little closer.</span>
                    <span className="hello-spark">✳</span>
                  </h1>
                  <p>Less noise. More of the conversations that matter.</p>
                </div>
                <button className="btn primary" onClick={() => setModal('add')}>
                  <UserPlus size={17} />
                  Add a friend
                </button>
              </section>
              <div className="friends-toolbar">
                <div className="tabs">
                  <button
                    className={filter === 'all' ? 'selected' : ''}
                    onClick={() => setFilter('all')}
                  >
                    All friends <span>{accepted.length}</span>
                  </button>
                  <button
                    className={filter === 'online' ? 'selected' : ''}
                    onClick={() => setFilter('online')}
                  >
                    Online <span>{countOnline}</span>
                  </button>
                  <button
                    className={filter === 'requests' ? 'selected' : ''}
                    onClick={() => setFilter('requests')}
                  >
                    Requests {requests.length > 0 && <span>{requests.length}</span>}
                  </button>
                </div>
                <span className="live-label">
                  <span className="tiny-dot" />
                  {countOnline} around now
                </span>
              </div>
              {filter === 'requests' ? (
                <section className="friends-area">
                  {requests.length ? (
                    requests.map((c) => (
                      <div className="friend-row" key={c.id}>
                        <Avatar profile={c} />
                        <div>
                          <strong>{c.name}</strong>
                          <small>
                            {c.pending === 'incoming'
                              ? 'Wants to be your friend'
                              : 'Invite sent · waiting for acceptance'}
                          </small>
                        </div>
                        {c.pending === 'incoming' && (
                          <button
                            className="btn primary small"
                            onClick={() => run(engine.acceptFriend(c.id))}
                          >
                            Accept
                          </button>
                        )}
                        <IconButton
                          label={c.pending === 'incoming' ? 'Decline request' : 'Cancel request'}
                          onClick={() => run(engine.removeFriend(c.id))}
                        >
                          <X size={18} />
                        </IconButton>
                      </div>
                    ))
                  ) : (
                    <div className="small-empty">
                      <Heart size={32} />
                      <h3>All caught up.</h3>
                      <p>New friend requests will appear here.</p>
                    </div>
                  )}
                </section>
              ) : accepted.filter((c) => filter !== 'online' || state.online.has(c.id)).length ? (
                <section className="friend-grid">
                  {accepted
                    .filter((c) => filter !== 'online' || state.online.has(c.id))
                    .map((c) => (
                      <button className="friend-card" key={c.id} onClick={() => openChat(c.id)}>
                        <div>
                          <Avatar profile={c} size={48} online={state.online.has(c.id)} />
                          <span className="friend-arrow">
                            <ArrowUpRight size={19} />
                          </span>
                        </div>
                        <h3>{c.name}</h3>
                        <p>{c.bio || 'A little closer.'}</p>
                        <span className="friend-status">
                          <span className={`tiny-dot ${state.online.has(c.id) ? '' : 'gray'}`} />
                          {state.online.has(c.id) ? 'Around now' : 'Offline · catch them later'}
                        </span>
                      </button>
                    ))}
                </section>
              ) : (
                <section className="empty-friends">
                  <div className="wind-scene">
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <span className="scene-dot dot-one" />
                    <span className="scene-dot dot-two" />
                    <span className="scene-star">✳</span>
                    <div className="floating-note note-one">
                      <Heart size={17} />
                      <span>hey, you around?</span>
                    </div>
                    <div className="floating-note note-two">
                      <span>always for you.</span>
                      <span>✌</span>
                    </div>
                    <div className="wind-cube">
                      <Wind size={62} strokeWidth={1.7} />
                    </div>
                  </div>
                  <div className="empty-copy">
                    <span className="eyebrow">
                      {filter === 'online' ? 'A QUIET MOMENT' : 'A FRESH START'}
                    </span>
                    <h2>
                      {filter === 'online'
                        ? 'A little quiet right now.'
                        : 'Every good chat starts with a hello.'}
                    </h2>
                    <p>
                      {filter === 'online'
                        ? 'Your friends are away. Send an invite to someone new or come back in a bit.'
                        : 'Bring your favorite people over. Share your invite, add a friend, and make yourself at home.'}
                    </p>
                    <button className="btn primary" onClick={() => setModal('invite')}>
                      <Link size={17} />
                      Share your invite
                      <ArrowUpRight size={16} />
                    </button>
                    <span className="empty-note">No phone number. No algorithm. Just you.</span>
                  </div>
                </section>
              )}
              <section className="feature-row">
                <div>
                  <span className="feature-icon lime">
                    <LockKeyhole size={19} />
                  </span>
                  <h3>Between you two.</h3>
                  <p>
                    Messages and calls travel over
                    <br />
                    an encrypted peer connection.
                  </p>
                </div>
                <div>
                  <span className="feature-icon lavender">
                    <Video size={20} />
                  </span>
                  <h3>More than a message.</h3>
                  <p>
                    Drop a photo. Jump on a call.
                    <br />
                    Share a little of your world.
                  </p>
                </div>
                <div>
                  <span className="feature-icon peach">
                    <Globe size={19} />
                  </span>
                  <h3>Wherever feels like home.</h3>
                  <p>
                    One space for your phone,
                    <br />
                    laptop, and favorite people.
                  </p>
                </div>
              </section>
              <footer className="home-footer">
                <Wind size={15} />
                <span>A little more human. A little more wind.</span>
                <span>MADE FOR CONNECTION</span>
              </footer>
            </div>
            <aside className="right-panel">
              <div className="right-heading">
                THE HERE & NOW <span className="tiny-dot" />
              </div>
              <div className="activity-card">
                <span className="activity-illustration">
                  <Volume2 size={28} />
                  <i />
                  <i />
                </span>
                <h3>
                  Good company.
                  <br />
                  Zero background noise.
                </h3>
                <p>This is your space to catch up, hang out, and just be.</p>
                <span className="handwritten">make yourself at home ↙</span>
              </div>
              <div className="online-heading">
                AROUND NOW <span>{countOnline}</span>
              </div>
              {accepted
                .filter((c) => state.online.has(c.id))
                .map((c) => (
                  <button className="online-person" key={c.id} onClick={() => openChat(c.id)}>
                    <Avatar profile={c} size={36} online />
                    <span>
                      <strong>{c.name}</strong>
                      <small>Ready for a conversation</small>
                    </span>
                    <MessageCircle size={16} />
                  </button>
                ))}
              {!countOnline && (
                <div className="quiet">
                  <span>☾</span>
                  <p>A quiet moment.</p>
                  <small>
                    When your friends come online,
                    <br />
                    you’ll find them here.
                  </small>
                </div>
              )}
              <div className="right-bottom">
                <ShieldCheck size={22} />
                <strong>
                  Your conversations.
                  <br />
                  Your business.
                </strong>
                <p>
                  No message storage on our server.
                  <br />
                  Your history stays on this device.
                </p>
                <button onClick={() => setModal('help')}>
                  How Wind works <ArrowUpRight size={14} />
                </button>
              </div>
            </aside>
          </div>
        )}
      </main>
      <nav className="mobile-nav">
        <button
          className={page === 'inbox' ? 'active' : ''}
          onClick={() => {
            setSelected(undefined);
            setPage('inbox');
          }}
        >
          <MessageCircle size={21} />
          <span>Inbox</span>
        </button>
        <button
          className={page === 'friends' ? 'active' : ''}
          onClick={() => {
            setSelected(undefined);
            setPage('friends');
          }}
        >
          <Users size={21} />
          <span>Friends {incoming.length > 0 && `(${incoming.length})`}</span>
        </button>
        <button onClick={() => setModal('add')}>
          <Plus size={23} />
          <span>Add friend</span>
        </button>
        <button aria-label="You" onClick={() => setModal('settings')}>
          <Avatar profile={me} size={23} />
          <span>You</span>
        </button>
      </nav>
      {state.call && <CallOverlay onError={engine.report} />}
      {state.error && (
        <div className="toast" role="alert">
          <span>{state.error}</span>
          <IconButton label="Dismiss notification" onClick={engine.clearError}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {(!me.name || modal) && (
        <ModalShell
          title={
            !me.name
              ? 'A little closer starts with you.'
              : modal === 'invite'
                ? 'Good things are better shared.'
                : modal === 'add'
                  ? 'Find your people.'
                  : modal === 'profile'
                    ? 'Make yourself at home.'
                    : modal === 'settings'
                      ? 'Your space. Your settings.'
                      : modal === 'verify'
                        ? 'A familiar face. A trusted key.'
                        : modal === 'clear'
                          ? 'Clear this conversation?'
                          : modal === 'remove'
                            ? 'Remove this friend?'
                            : 'A little more about Wind.'
          }
          onClose={me.name ? () => setModal(null) : undefined}
        >
          {!me.name || modal === 'profile' ? (
            <ProfileForm
              profile={me}
              initial={!me.name}
              onSave={async (changes) => {
                await engine.updateProfile(changes);
                setModal(null);
              }}
            />
          ) : modal === 'invite' ? (
            <>
              <p className="modal-description">
                Send your personal invite to someone you trust. They’ll paste it in Wind and send
                you a friend request.
              </p>
              <div className="invite-profile">
                <Avatar profile={me} size={54} />
                <div>
                  <strong>{me.name}</strong>
                  <small>A space for your kind of people.</small>
                </div>
                <Wind size={26} />
              </div>
              <label className="field-label">
                YOUR WIND INVITE
                <textarea
                  className="invite-code"
                  aria-label="Your Wind invite"
                  readOnly
                  value={inviteCode(me)}
                  rows={3}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button className="btn primary full" onClick={() => void copyInvite()}>
                {copied ? <Check size={17} /> : <Copy size={17} />}{' '}
                {copied ? 'Invite copied!' : 'Copy your invite'}
              </button>
              <p className="form-note">
                <LockKeyhole size={13} />
                Your invite contains your public profile, never your private key.
              </p>
            </>
          ) : modal === 'add' ? (
            <AddFriend
              onDone={() => {
                setModal(null);
                setFilter('requests');
              }}
            />
          ) : modal === 'settings' ? (
            <SettingsForm
              profile={me}
              server={state.server}
              status={state.status}
              onProfile={() => setModal('profile')}
            />
          ) : modal === 'verify' && peer ? (
            <>
              <p className="modal-description">
                Compare this fingerprint with {peer.name} over a separate trusted channel. Matching
                fingerprints confirm you have their real identity key.
              </p>
              <div className="fingerprint">{fingerprint.match(/.{1,4}/g)?.join(' ')}</div>
              <p className="form-note">
                This key pins the signed connection setup for your messages and calls.
              </p>
              <button
                className="btn primary full"
                onClick={() => {
                  run(engine.markVerified(peer.id));
                  setModal(null);
                }}
              >
                <ShieldCheck size={18} />
                {peer.verified ? 'Remove verification' : 'We compared · mark verified'}
              </button>
            </>
          ) : modal === 'clear' && peer ? (
            <>
              <p className="modal-description">
                This deletes your local message history and attachments with {peer.name}. Their copy
                will remain. This can’t be undone.
              </p>
              <button
                className="btn danger full"
                onClick={() => {
                  run(engine.clearHistory(peer.id));
                  setModal(null);
                }}
              >
                Delete local history
              </button>
            </>
          ) : modal === 'remove' && peer ? (
            <>
              <p className="modal-description">
                This disconnects you from {peer.name}. Your local history remains until you clear
                it.
              </p>
              <button
                className="btn danger full"
                onClick={() => {
                  run(engine.removeFriend(peer.id));
                  setSelected(undefined);
                  setModal(null);
                }}
              >
                Remove friend
              </button>
            </>
          ) : (
            <div className="help-content">
              <div>
                <ShieldCheck />
                <h3>Private, by connection.</h3>
                <p>
                  Messages, attachments, and calls use WebRTC’s encrypted data and media channels.
                  Signed connection setup binds them to a friend’s saved identity key. Compare
                  fingerprints to verify who’s on the other end.
                </p>
              </div>
              <div>
                <Users />
                <h3>A rendezvous, not a mailbox.</h3>
                <p>
                  The server connects online peers and sees public profiles, IP addresses, presence,
                  and connection metadata. It never stores chat content. Both friends must be online
                  to send or receive; there is no offline inbox or multi-device sync.
                </p>
              </div>
              <div>
                <MonitorUp />
                <h3>A little face time.</h3>
                <p>
                  Voice, video, and camera controls need microphone and camera permission. Screen
                  sharing works on supported desktop browsers and the desktop app. Mobile can view
                  shared screens; broadcasting a mobile screen needs native integration.
                </p>
              </div>
              <div>
                <LockKeyhole />
                <h3>Your device is your home.</h3>
                <p>
                  Your identity and chat history are saved in this app’s local browser storage.
                  History isn’t encrypted at rest. Clearing app data loses your identity. Embedded
                  videos only contact their provider after you choose to load them.
                </p>
              </div>
              <a
                href="https://webrtc.org/getting-started/peer-connections"
                target="_blank"
                rel="noreferrer"
              >
                About WebRTC connections <ArrowUpRight size={14} />
              </a>
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}
function Chat({
  peer,
  me,
  messages,
  connected,
  typing,
  run,
  onInvite,
}: {
  peer: Contact;
  me: Profile;
  messages: ChatMessage[];
  connected: boolean;
  typing: boolean;
  run: (p: Promise<unknown>) => void;
  onInvite: () => void;
}) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  useEffect(() => {
    setText('');
    setEmoji(false);
  }, [peer.id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [peer.id, messages.length, typing]);
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await engine.sendText(peer.id, text);
      setText('');
      engine.typing(peer.id, false);
      input.current?.focus();
    } catch (e) {
      engine.report(e);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="chat">
      <div className="messages">
        <div className="chat-welcome">
          <Avatar profile={peer} size={76} />
          <h1>
            This is the start of
            <br />
            something good.
          </h1>
          <p>
            Your conversation with <strong>{peer.name}</strong>. Just between you two.
          </p>
          <span className="encrypted-pill">
            <LockKeyhole size={12} />
            End-to-end encrypted{peer.verified && ' · Identity verified'}
          </span>
        </div>
        <div className="day-divider">
          <span>YOUR CONVERSATION</span>
        </div>
        {messages.map((m, index) => {
          const profile = m.from === me.id ? me : peer;
          const grouped =
            index > 0 &&
            messages[index - 1].from === m.from &&
            m.at - messages[index - 1].at < 180000;
          return (
            <article
              key={m.id}
              className={`message ${grouped ? 'grouped' : ''}`}
              data-testid="message"
            >
              {!grouped ? (
                <Avatar profile={profile} size={36} />
              ) : (
                <span className="message-spacer" />
              )}
              <div className="message-content">
                {!grouped && (
                  <div className="message-heading">
                    <strong>{profile.name}</strong>
                    <time dateTime={new Date(m.at).toISOString()}>
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    {m.from === me.id && <span className="you-label">YOU</span>}
                  </div>
                )}
                {m.text && <MessageText text={m.text} />} {m.file && <Attachment file={m.file} />}{' '}
                {m.from === me.id && (
                  <span className={`message-state ${m.state}`} aria-label={m.state}>
                    {m.state === 'delivered' ? (
                      <>
                        <CheckCheck size={12} />
                        Delivered
                      </>
                    ) : m.state === 'sending' ? (
                      <>
                        <LoaderCircle size={11} />
                        Sending
                      </>
                    ) : (
                      <>Not delivered · send again when connected</>
                    )}
                  </span>
                )}
              </div>
            </article>
          );
        })}
        <div ref={bottom} />
      </div>
      <div className="composer-area">
        <div className="typing-line">
          {typing && (
            <>
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {peer.name} is typing
            </>
          )}
        </div>
        <form
          className={`composer ${connected ? '' : 'disconnected'}`}
          onSubmit={(e) => void send(e)}
        >
          <IconButton
            label="Attach a photo, video, or file"
            disabled={!connected}
            onClick={() => file.current?.click()}
          >
            <Plus size={23} />
          </IconButton>
          <textarea
            ref={input}
            aria-label={`Message ${peer.name}`}
            placeholder={connected ? `Message ${peer.name}…` : `${peer.name} isn’t connected yet`}
            value={text}
            maxLength={8000}
            rows={1}
            onChange={(e) => {
              setText(e.target.value);
              if (Date.now() - lastTyping.current > 1500) {
                engine.typing(peer.id, !!e.target.value);
                lastTyping.current = Date.now();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="emoji-wrap">
            <IconButton label="Choose an emoji" onClick={() => setEmoji(!emoji)}>
              <Smile size={21} />
            </IconButton>
            {emoji && (
              <div className="emoji-picker">
                {['👋', '💚', '😂', '✨', '🙌', '🥹', '🌿', '❤️', '🔥', '👍', '🎉', '🤍'].map(
                  (e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        setText((t) => t + e);
                        setEmoji(false);
                        input.current?.focus();
                      }}
                    >
                      {e}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
          <button
            className="send-btn"
            type="submit"
            disabled={!connected || !text.trim() || sending}
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
          <input
            ref={file}
            type="file"
            aria-label="Choose attachment"
            className="visually-hidden"
            onChange={(e) => {
              const attachment = e.target.files?.[0];
              if (attachment) run(engine.sendFile(peer.id, attachment));
              e.target.value = '';
            }}
          />
        </form>
        <div className="composer-caption">
          <span>
            <LockKeyhole size={11} />
            Just between you and {peer.name}
          </span>
          {connected ? (
            <span>
              Enter to send <span className="desktop-only">· Shift + Enter for a new line</span>
            </span>
          ) : (
            <button onClick={() => engine.reconnectPeer(peer.id)}>
              Try connecting <Link size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, textarea, a[href]',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
      >
        <div className="modal-top">
          <span className="modal-logo">
            <Wind size={25} />
          </span>
          {onClose && (
            <IconButton label="Close dialog" onClick={onClose}>
              <X size={21} />
            </IconButton>
          )}
        </div>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
const colors = ['#b9ef69', '#bdadf7', '#f4b391', '#8fd2dd', '#eaa9c2', '#f0d478'];
function ProfileForm({
  profile,
  initial,
  onSave,
}: {
  profile: Profile;
  initial: boolean;
  onSave: (changes: Partial<Profile>) => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [color, setColor] = useState(profile.color);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024)
        throw new Error('Choose a PNG, JPG, WebP, or GIF under 10 MB.');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas
        .getContext('2d')!
        .drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          192,
          192,
        );
      bitmap.close();
      const data = canvas.toDataURL('image/webp', 0.75);
      if (data.length > 99000)
        throw new Error('That image is too detailed. Choose a smaller picture.');
      setAvatar(data);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSave({ name, bio, color, avatar })
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <p className="modal-description">
        {initial
          ? 'Pick a name and a face your friends will recognize. No email, phone number, or password needed.'
          : 'A familiar name. A little personality. All you.'}
      </p>
      <div className="profile-editor">
        <button
          type="button"
          className="avatar-upload"
          aria-label="Upload profile picture"
          onClick={() => file.current?.click()}
        >
          <Avatar profile={{ name, color, avatar }} size={76} />
          <span>
            <Plus size={14} />
          </span>
        </button>
        <div>
          <strong>Your profile picture</strong>
          <small>Give your hello a familiar face.</small>
          <button className="text-link" type="button" onClick={() => file.current?.click()}>
            Upload photo
          </button>
          {avatar && (
            <button type="button" className="text-link muted" onClick={() => setAvatar(undefined)}>
              Remove
            </button>
          )}
        </div>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="visually-hidden"
          ref={file}
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0]);
          }}
        />
      </div>
      <label className="field-label">
        DISPLAY NAME
        <input
          required
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What do your people call you?"
          autoComplete="nickname"
        />
      </label>
      <label className="field-label">
        A LITTLE ABOUT YOU <span>optional</span>
        <textarea
          maxLength={140}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={2}
          placeholder="A mood, a thought, a little hello."
        />
      </label>
      <label className="field-label">YOUR COLOR</label>
      <div className="color-picker">
        {colors.map((c) => (
          <button
            type="button"
            key={c}
            style={{ background: c }}
            aria-label={`Choose ${c}`}
            aria-pressed={color === c}
            className={color === c ? 'selected' : ''}
            onClick={() => setColor(c)}
          >
            {color === c && <Check size={17} />}
          </button>
        ))}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary full" disabled={!name.trim() || busy}>
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : initial ? (
          <>
            Let’s get some fresh air <ArrowRight size={17} />
          </>
        ) : (
          <>
            Save your profile <Check size={17} />
          </>
        )}
      </button>
      <p className="form-note">
        <LockKeyhole size={12} />
        {initial
          ? 'A device identity is created and saved here. Keep this app’s data safe.'
          : 'Your profile is shared with the people you connect with.'}
      </p>
    </form>
  );
}
function AddFriend({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void parseInvite(value)
          .then((p) => engine.addFriend(p))
          .then(onDone)
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <p className="modal-description">
        Every good conversation starts somewhere. Paste your friend’s Wind invite to send a request.
      </p>
      <label className="field-label">
        THEIR WIND INVITE
        <textarea
          placeholder="wind:eyJ…"
          aria-label="Friend invite"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          maxLength={150000}
          required
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary full" disabled={!value.trim() || busy}>
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <>
            <UserPlus size={17} />
            Send friend request
          </>
        )}
      </button>
      <p className="form-note">
        <ShieldCheck size={13} />
        Only accept invites from people you know and trust.
      </p>
    </form>
  );
}
function SettingsForm({
  profile,
  server,
  status,
  onProfile,
}: {
  profile: Profile;
  server: string;
  status: string;
  onProfile: () => void;
}) {
  const [url, setUrl] = useState(server);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <>
      <button className="settings-profile" onClick={onProfile}>
        <Avatar profile={profile} size={49} />
        <span>
          <strong>{profile.name}</strong>
          <small>Edit your name, bio & photo</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <div className="setting-section">
        <h3>
          <Globe size={17} />
          Your connection
        </h3>
        <p>
          Use the same Wind signaling server as your friends. A server helps peers find each other.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void engine
              .setServer(url)
              .then(() => setSaved(true))
              .catch((e) => setError(e.message));
          }}
        >
          <label className="field-label">
            SERVER URL
            <input
              type="url"
              required
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSaved(false);
              }}
              placeholder="https://wind.example.com"
            />
          </label>
          {error && <p className="inline-error">{error}</p>}
          <button className="btn secondary full">
            {saved ? <Check size={16} /> : <Link size={16} />}{' '}
            {saved ? 'Connection settings saved' : 'Save & reconnect'}
          </button>
        </form>
        <span className="server-status">
          <span className={`tiny-dot ${status === 'online' ? '' : 'gray'}`} />
          {status === 'online'
            ? 'Connected to signaling'
            : status === 'connecting'
              ? 'Connecting…'
              : 'Disconnected'}
        </span>
      </div>
      <div className="setting-section">
        <h3>
          <ShieldCheck size={17} />
          On this device
        </h3>
        <p>
          Your identity and message history live here. There’s no account recovery or device sync
          yet. Clearing app data creates a new identity.
        </p>
        <code className="device-id">{profile.id}</code>
      </div>
      <div className="version">
        <Wind size={16} />
        Wind 0.1.0 <span>A little closer.</span>
      </div>
    </>
  );
}
function CallOverlay({ onError }: { onError: (e: unknown) => void }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const call = state.call!;
  const peer = state.contacts.find((c) => c.id === call.peer)!;
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const timer = setInterval(
      () => setDuration(call.started ? Math.floor((Date.now() - call.started) / 1000) : 0),
      1000,
    );
    return () => clearInterval(timer);
  }, [call.started]);
  const remoteVideo =
    (call.remoteCamera || call.remoteSharing) &&
    call.remote?.getVideoTracks().some((t) => t.readyState === 'live');
  return (
    <section className={`call-overlay ${expanded ? '' : 'compact'}`} aria-label="Call">
      <div className="call-top">
        <span>
          <LockKeyhole size={13} />
          ENCRYPTED CALL
        </span>
        <IconButton
          label={expanded ? 'Minimize call' : 'Expand call'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronRight size={19} /> : <Video size={19} />}
        </IconButton>
      </div>
      <div className="call-stage">
        {remoteVideo ? (
          <Stream stream={call.remote} className="remote-video" />
        ) : (
          <>
            <Stream stream={call.remote} audioOnly />
            <div className="call-person">
              <div
                className={`call-avatar ${call.phase === 'incoming' || call.phase === 'outgoing' ? 'ringing' : ''}`}
              >
                <Avatar profile={peer} size={88} />
              </div>
              <h2>{peer.name}</h2>
              <p>
                {call.phase === 'incoming'
                  ? `Incoming ${call.video ? 'video' : 'voice'} call`
                  : call.phase === 'outgoing'
                    ? 'Calling…'
                    : call.phase === 'connecting'
                      ? 'Connecting…'
                      : 'A little closer.'}
              </p>
            </div>
          </>
        )}
        {(call.camera || call.sharing) && (
          <Stream stream={call.local} muted className="local-video" />
        )}
        <div className="call-duration">
          {call.remoteSharing && <span>Screen shared · </span>}
          {call.remoteMuted && <span>Mic muted · </span>}
          {call.phase === 'active'
            ? `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`
            : call.phase === 'incoming'
              ? 'Your friend is calling'
              : 'Waiting to connect'}
        </div>
      </div>
      <div className="call-controls">
        {call.phase === 'incoming' ? (
          <>
            <button
              className="btn primary"
              onClick={() => {
                void engine.answerCall().catch(onError);
              }}
            >
              <Phone size={19} />
              Answer
            </button>
            <button className="btn danger" onClick={() => engine.endCall()}>
              <PhoneOff size={19} />
              Decline
            </button>
          </>
        ) : (
          <>
            <IconButton
              label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
              className={call.muted ? 'toggled' : ''}
              onClick={() => engine.toggleMute()}
            >
              {call.muted ? <MicOff size={21} /> : <Mic size={21} />}
            </IconButton>
            <IconButton
              label={call.camera ? 'Turn camera off' : 'Turn camera on'}
              className={call.camera ? '' : 'toggled'}
              onClick={() => {
                void engine.toggleCamera().catch(onError);
              }}
            >
              {call.camera ? <Video size={22} /> : <VideoOff size={22} />}
            </IconButton>
            <IconButton
              label={call.sharing ? 'Stop screen sharing' : 'Share screen'}
              disabled={call.phase !== 'active'}
              className={call.sharing ? 'sharing' : ''}
              onClick={() => {
                void engine.shareScreen().catch(onError);
              }}
            >
              <MonitorUp size={21} />
            </IconButton>
            <IconButton label="End call" className="hangup" onClick={() => engine.endCall()}>
              <PhoneOff size={22} />
            </IconButton>
          </>
        )}
      </div>
    </section>
  );
}
