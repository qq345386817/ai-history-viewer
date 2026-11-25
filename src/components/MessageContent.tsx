import { useMemo, useState } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ImageOff, ImagePlus, ExternalLink } from "lucide-react";
import type { Message } from "../../shared/types";
import { searchHighlight } from "../searchHighlight";

const markdownPlugins = [remarkGfm];
const userMarkdownPlugins = [remarkGfm, remarkBreaks];

function MessageImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const remote = /^https?:\/\//i.test(src || "");
  const [loaded, setLoaded] = useState(!remote);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return (
    <span className="image-unavailable" role="status">
      <ImageOff size={18} aria-hidden="true" />
      <span>{alt || "图片"} · 无法显示，文件可能已移除或格式不受支持</span>
    </span>
  );
  if (!loaded) return (
    <span className="remote-image">
      <span>{alt || "远程图片"} · {new URL(src).host}</span>
      <button className="plain-button" onClick={() => setLoaded(true)}>
        <ImagePlus size={16} aria-hidden="true" />加载远程图片
      </button>
    </span>
  );
  return (
    <span className="message-image">
      <a href={src} target="_blank" rel="noreferrer noopener" title={title || "点击查看原图"}>
        <img src={src} alt={alt || "图片附件"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </a>
      <span className="image-caption">
        <span>{alt || "图片附件"}</span>
        <a href={src} target="_blank" rel="noreferrer noopener">查看原图<ExternalLink size={12} aria-hidden="true" /></a>
      </span>
    </span>
  );
}

export default function MessageContent({ message, query }: { message: Message; query: string }) {
  const rehypePlugins = useMemo(() => [[searchHighlight, { query }] as [typeof searchHighlight, { query: string }]], [query]);
  // Stable renderer types preserve loaded remote images during SSE refreshes.
  const mediaKey = JSON.stringify(message.media || {});
  const components = useMemo<Components>(() => {
    const media: NonNullable<Message["media"]> = JSON.parse(mediaKey);
    const mediaUrls = new Set(Object.values(media).flatMap((m) => m.url ? [m.url] : []));
    return {
        a: ({ children, href, node }) => {
          // Image renderers supply their own original-image link.
          if (node?.children.some((n) => n.type === "element" && n.tagName === "img"))
            return <span>{children}</span>;
          if (href && mediaUrls.has(href))
            return <MessageImage key={href} src={href} alt={typeof children === "string" ? children : "图片附件"} />;
          return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
        },
        img: ({ src, alt, title }) => <MessageImage key={typeof src === "string" ? src : "unavailable"} src={typeof src === "string" ? src : undefined} alt={alt} title={title} />,
        input: ({ checked }) => <input type="checkbox" checked={checked || false} disabled readOnly />,
    };
  }, [mediaKey]);
  return <div className="markdown">
    <Markdown remarkPlugins={message.role === "user" ? userMarkdownPlugins : markdownPlugins} rehypePlugins={rehypePlugins} skipHtml
      urlTransform={(url, key) => {
        const media = message.media && Object.hasOwn(message.media, url) ? message.media[url] : undefined;
        if (media) return media.url || "";
        return key === "src" ? "" : defaultUrlTransform(url);
      }}
      components={components}
    >{message.content}</Markdown>
  </div>;
}
