// @vitest-environment jsdom
/*
 * NeonPlugJA — 名前入力欄の IME 対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
/**
 * 日本語名の入力欄は、上限（バイト）を超えた分を切り詰める。
 * IME の変換中にも毎回切ると、上限の近くで変換中の文字が消えて、末尾の字が変換入力できない
 * （貼り付けなら入る）。変換中は切らず、確定したあとに切ることを確かめる。
 */
import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { fitNameBytes, imeFitHandlers } from '../../src/utils/japaneseNames';
import { InlineAddInput } from '../../src/components/ui/InlineAddInput';

afterEach(cleanup);

const Field: React.FC<{ max: number; onValue?: (v: string) => void }> = ({ max, onValue }) => {
  const [v, setV] = useState('');
  return (
    <input
      data-testid="f"
      value={v}
      {...imeFitHandlers(
        (x) => fitNameBytes(x, max),
        (x) => {
          setV(x);
          onValue?.(x);
        },
      )}
    />
  );
};

const input = (c: ReturnType<typeof render>) => c.getByTestId('f') as HTMLInputElement;

describe('imeFitHandlers', () => {
  it('変換していない入力（貼り付けなど）は、そのまま上限で切る', () => {
    const c = render(<Field max={8} />);
    fireEvent.change(input(c), { target: { value: 'あいうえおかきく' } }); // 16 バイト
    expect(input(c).value).toBe('あいうえ'); // 8 バイト = 4 字
  });

  it('変換中は切らない。確定したら上限で切る', () => {
    const c = render(<Field max={8} />);
    const el = input(c);
    fireEvent.change(el, { target: { value: 'あいうえ' } }); // ちょうど 8 バイト
    fireEvent.compositionStart(el);
    // 末尾に変換中の文字（未確定）が付いて、一時的に上限を超える
    fireEvent.change(el, { target: { value: 'あいうえかきく' } });
    expect(el.value).toBe('あいうえかきく'); // 変換中の文字は消えない
    fireEvent.compositionEnd(el);
    expect(el.value).toBe('あいうえ'); // 確定後に上限へ切る
  });

  it('変換中に 1 字ずつ増えても、上限内なら確定後もそのまま残る', () => {
    const c = render(<Field max={8} />);
    const el = input(c);
    fireEvent.compositionStart(el);
    fireEvent.change(el, { target: { value: 'あいう' } });
    fireEvent.change(el, { target: { value: 'あいうえ' } });
    fireEvent.compositionEnd(el);
    expect(el.value).toBe('あいうえ');
  });

  it('変換が終わったあとの入力は、また切る', () => {
    const c = render(<Field max={4} />);
    const el = input(c);
    fireEvent.compositionStart(el);
    fireEvent.compositionEnd(el);
    fireEvent.change(el, { target: { value: 'ABCDEFG' } });
    expect(el.value).toBe('ABCD');
  });
});

describe('InlineAddInput（fit あり）', () => {
  const Add: React.FC = () => {
    const [v, setV] = useState('');
    return <InlineAddInput value={v} onChange={setV} onSubmit={() => {}} placeholder="p" fit={(x) => fitNameBytes(x, 6)} />;
  };

  it('変換中は切らず、確定後に切る', () => {
    const c = render(<Add />);
    const el = c.getByPlaceholderText('p') as HTMLInputElement;
    fireEvent.compositionStart(el);
    fireEvent.change(el, { target: { value: 'あいうえお' } });
    expect(el.value).toBe('あいうえお');
    fireEvent.compositionEnd(el);
    expect(el.value).toBe('あいう');
  });
});
