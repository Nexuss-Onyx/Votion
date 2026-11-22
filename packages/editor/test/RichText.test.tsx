import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RichTextSegment, TextModifier } from '@votion/types';
import { RichTextRenderer } from '../src/richtext/RichTextRenderer.js';

const segment = (
  content: string,
  modifiers?: TextModifier[],
): RichTextSegment =>
  modifiers ? [content, modifiers] : [content];

describe('RichTextRenderer', () => {
  it('renders plain text segments', () => {
    render(<RichTextRenderer richText={[['Hello'], [' world']]} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('applies bold, italic, strikethrough and underline classes', () => {
    const richText: RichTextSegment[] = [
      segment('b', [['b']]),
      segment('i', [['i']]),
      segment('s', [['s']]),
      segment('u', [['_']]),
      segment('c', [['c']]),
    ];
    render(<RichTextRenderer richText={richText} />);

    expect(screen.getByText('b')).toHaveClass('is-bold');
    expect(screen.getByText('i')).toHaveClass('is-italic');
    expect(screen.getByText('s')).toHaveClass('is-strikethrough');
    expect(screen.getByText('u')).toHaveClass('is-underline');
    expect(screen.getByText('c')).toHaveClass('is-code');
  });

  it('applies text color and highlight classes', () => {
    render(
      <RichTextRenderer richText={[segment('blue', [['h', 'blue']])]} />,
    );
    expect(screen.getByText('blue')).toHaveClass('color-blue');

    render(
      <RichTextRenderer richText={[segment('bg', [['h', 'yellow_background']])]} />,
    );
    expect(screen.getByText('bg')).toHaveClass('highlight-yellow_background');
  });

  it('renders links as anchors', () => {
    render(
      <RichTextRenderer richText={[segment('link', [['a', 'https://example.com']])]} />,
    );
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders inline equations via KaTeX', () => {
    render(
      <RichTextRenderer richText={[segment('x', [['e', 'e^{i\\pi}']])]} />,
    );
    expect(
      document.querySelector('.inline-equation'),
    ).not.toBeNull();
  });

  it('renders date mentions as their start date', () => {
    render(
      <RichTextRenderer richText={[segment(' ', [['d', { type: 'date', start_date: '2026-11-22' }]])]} />,
    );
    expect(screen.getByText('2026-11-22')).toBeInTheDocument();
  });
});
