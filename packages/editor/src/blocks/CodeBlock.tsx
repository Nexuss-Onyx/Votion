import { useCallback, useMemo, useState } from 'react';
import Prism from 'prismjs';
import type { Block, UUID } from '@votion/types';
import { richTextToPlainText } from '@votion/types';
import type { BlockEditorActions } from '../lib/editor.js';

export interface CodeBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

const CODE_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'text', label: 'Plain text' },
];

/**
 * Code block: syntax highlighted via Prism, with a language selector and a
 * copy button. Code is stored in `properties.title` as rich text.
 */
export function CodeBlock({
  block,
  editor,
}: CodeBlockProps): JSX.Element {
  const [language, setLanguage] = useState(
    block.properties.language?.[0]?.[0] ?? 'javascript',
  );
  const code = richTextToPlainText(block.properties.title);

  const grammar = (Prism.languages as unknown as Record<string, unknown>)[language];

  const highlighted = useMemo(() => {
    if (!grammar || language === 'text') {
      return code.replace(/[&<>"']/g, (char) => {
        switch (char) {
          case '&': return '&amp;';
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '"': return '&quot;';
          default: return '&#39;';
        }
      });
    }
    return Prism.highlight(code, grammar as never, language) as never;
  }, [code, language, grammar]);

  const handleLanguageChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setLanguage(event.target.value);
    editor.patchBlock(block.id, { properties: { language: [[event.target.value]] } });
  }, [block.id, editor]);

  const handleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  }, [code]);

  return (
    <div className="code-block my-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs border-b border-gray-200 bg-gray-50">
        <select
          value={language}
          onChange={handleLanguageChange}
          className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700 outline-none"
        >
          {CODE_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Copy code"
          onClick={handleCopy}
          className="text-gray-500 hover:text-gray-900"
        >
          Copy
        </button>
      </div>
      <pre className="m-0 overflow-x-auto">
        <code
          contentEditable={true}
          suppressContentEditableWarning
          onBlur={(event) => handleChange(event.currentTarget.innerText)}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
