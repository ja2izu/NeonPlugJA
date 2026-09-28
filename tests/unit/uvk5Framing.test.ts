/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect } from 'vitest';
import {
  scramble, crc16, buildFrame, frameBodyLength, readFrameBody, payloadCommand,
  helloPayload, readMemPayload, writeMemPayload, firmwareFromHello,
  memoryFromReadReply, writeAccepted, CMD,
} from '../../src/radios/uvk5/framing';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

describe('UV-K5 の枠組み立て', () => {
  it('CRC-16/XMODEM', () => {
    expect(crc16(helloPayload())).toBe(0x9c98);
    expect(crc16(new Uint8Array(0))).toBe(0);
  });

  it('難読化は2回掛けると元に戻る', () => {
    const data = Uint8Array.from({ length: 40 }, (_, i) => i * 7);
    expect(hex(scramble(scramble(data)))).toBe(hex(data));
  });

  it('挨拶の包み', () => {
    expect(hex(buildFrame(helloPayload()))).toBe('ABCD0800026910E644A85A24B9A9DCBA');
  });

  it('読出コマンド（0x0F50 から 0x80 バイト）', () => {
    expect(hex(readMemPayload(0x0f50, 0x80))).toBe('1B050800500F80006A395764');
    expect(hex(buildFrame(readMemPayload(0x0f50, 0x80))))
      .toBe('ABCD0C000D691CE67E9E8D404B0C8224DBADDCBA');
  });

  it('書込コマンド（0x0080 に 8 バイト）', () => {
    const data = Uint8Array.from({ length: 8 }, (_, i) => i);
    expect(hex(writeMemPayload(0x0080, data))).toBe('1D051000800008016A3957640001020304050607');
  });

  it('包みを解くと元の中身に戻る', () => {
    const payload = readMemPayload(0x1234, 0x80);
    const frame = buildFrame(payload);
    expect(frameBodyLength(frame.subarray(0, 4))).toBe(payload.length);
    expect(hex(readFrameBody(frame.subarray(4), payload.length))).toBe(hex(payload));
  });

  it('終端が壊れた応答は拒否する', () => {
    const frame = buildFrame(helloPayload());
    const broken = new Uint8Array(frame);
    broken[broken.length - 1] = 0x00;
    expect(() => readFrameBody(broken.subarray(4), helloPayload().length)).toThrow();
    expect(() => readFrameBody(new Uint8Array(4), 8)).toThrow();
  });

  it('コマンドの識別', () => {
    expect(payloadCommand(helloPayload())).toBe(CMD.HELLO);
    expect(payloadCommand(readMemPayload(0, 0x80))).toBe(CMD.READ_MEM);
    expect(payloadCommand(writeMemPayload(0, new Uint8Array(8)))).toBe(CMD.WRITE_MEM);
  });
});

describe('UV-K5 の応答の読み取り', () => {
  it('挨拶の応答からファームの版を取り出す', () => {
    const reply = fromHex('15052000463448574E2076342E3300000000000000000000');
    expect(payloadCommand(reply)).toBe(CMD.HELLO_REPLY);
    expect(firmwareFromHello(reply)).toBe('F4HWN v4.3');
  });

  it('読出の応答は 8 バイトの見出しを除いた部分が中身', () => {
    const body = Uint8Array.from({ length: 0x80 }, (_, i) => i & 0xff);
    const reply = new Uint8Array(8 + body.length);
    reply.set([0x1c, 0x05, 0x88, 0x00, 0x50, 0x0f, 0x80, 0x00]);
    reply.set(body, 8);
    expect(hex(memoryFromReadReply(reply))).toBe(hex(body));
    expect(() => memoryFromReadReply(new Uint8Array(4))).toThrow();
  });

  it('書込の応答は、頼んだ位置と一致したときだけ成功とみなす', () => {
    const ok = Uint8Array.of(0x1e, 0x05, 0x04, 0x00, 0x80, 0x00);
    expect(writeAccepted(ok, 0x0080)).toBe(true);
    expect(writeAccepted(ok, 0x0180)).toBe(false);
    expect(writeAccepted(Uint8Array.of(0x1c, 0x05, 0x04, 0x00, 0x80, 0x00), 0x0080)).toBe(false);
  });
});
