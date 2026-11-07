import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Play, ExternalLink } from 'lucide-react';
import type { ChatMessage } from './identity';

export function Stream({
  stream,
  muted = false,
  className = '',
  audioOnly = false,
}: {
  stream?: MediaStream;
  muted?: boolean;
  className?: string;
  audioOnly?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream || null;
    if (stream)
      void video
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`${className} ${audioOnly ? 'audio-only' : ''}`}
      />
      {blocked && (
        <button
          className="btn secondary play-audio"
          onClick={() => {
            void ref.current?.play().then(() => setBlocked(false));
          }}
        >
          Enable call audio
        </button>
      )}
    </>
  );
}
export function Attachment({ file }: { file: NonNullable<ChatMessage['file']> }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file.blob);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file.blob]);
  return (
    <div className="attachment">
      {['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={file.name} loading="lazy" />
        </a>
      ) : ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(file.type) ? (
        <video src={url} controls playsInline preload="metadata" aria-label={file.name} />
      ) : (
        <div className="file-tile">
          <FileText size={26} />
          <span>
            {file.name}
            <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
          </span>
        </div>
      )}
      <a className="file-caption" href={url} download={file.name}>
        {file.name}
        <Download size={14} />
      </a>
    </div>
  );
}
export function MessageText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+)/g);
  const first = parts.find((t) => /^https?:/.test(t));
  let embed: { src: string; title: string; direct?: boolean } | undefined;
  if (first)
    try {
      const url = new URL(first);
      const id =
        url.hostname === 'youtu.be'
          ? url.pathname.slice(1)
          : ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
            ? url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1]
            : '';
      if (id && /^[\w-]{11}$/.test(id))
        embed = { src: `https://www.youtube-nocookie.com/embed/${id}`, title: 'YouTube video' };
      else if (
        ['vimeo.com', 'www.vimeo.com'].includes(url.hostname) &&
        /^\/\d+$/.test(url.pathname)
      )
        embed = { src: `https://player.vimeo.com/video${url.pathname}`, title: 'Vimeo video' };
      else if (url.protocol === 'https:' && /\.(mp4|webm|ogg)$/i.test(url.pathname))
        embed = { src: url.href, title: 'Video', direct: true };
    } catch {
      /* plain text remains readable */
    }
  return (
    <>
      <p className="message-text">
        {parts.map((part, i) =>
          /^https?:\/\//.test(part) ? (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer">
              {part}
            </a>
          ) : (
            part
          ),
        )}
      </p>
      {embed && <VideoEmbed key={embed.src} embed={embed} />}
    </>
  );
}
function VideoEmbed({ embed }: { embed: { src: string; title: string; direct?: boolean } }) {
  const [loaded, setLoaded] = useState(false);
  if (!loaded)
    return (
      <button className="embed-preview" onClick={() => setLoaded(true)}>
        <span className="embed-play">
          <Play size={23} fill="currentColor" />
        </span>
        <span>
          {embed.title}
          <small>Load from provider · shares your IP</small>
        </span>
        <ExternalLink size={16} />
      </button>
    );
  return embed.direct ? (
    <video className="video-embed" controls playsInline src={embed.src} />
  ) : (
    <iframe
      className="video-embed"
      src={embed.src}
      title={embed.title}
      sandbox="allow-scripts allow-same-origin allow-presentation"
      allow="encrypted-media; fullscreen; picture-in-picture"
      referrerPolicy="no-referrer"
      allowFullScreen
    />
  );
}
