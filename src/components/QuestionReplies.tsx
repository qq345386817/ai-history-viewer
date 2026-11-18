import { Check } from "lucide-react";
import type { QuestionReply } from "../../shared/types";
import { searchPattern } from "../searchHighlight";

function highlightedText(text: string, query: string) {
  const pattern = searchPattern(query);
  if (!pattern) return text;
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(end, match.index));
    parts.push(<mark key={match.index} data-search-match>{match[0]}</mark>);
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return parts;
}

export default function QuestionReplies({ replies, query }: {
  replies: QuestionReply[];
  query: string;
}) {
  return (
    <div className="question-replies" role="group" aria-label="历史问答">
      {replies.map(({ question, answer }, index) => (
        <dl className="question-reply" key={index}>
          <dt>AI 提问</dt>
          <dd className="question-reply-question">{highlightedText(question, query)}</dd>
          <dt>你的回答</dt>
          <dd className="question-reply-answer">
            {answer && <Check size={16} aria-hidden="true" />}
            <span>{highlightedText(answer || "未作答", query)}</span>
          </dd>
        </dl>
      ))}
    </div>
  );
}
