// File: src/core/context/context-management/__tests__/truncator.spec.ts
import 'module-alias/register';
import { expect } from 'chai';
import { ContextManager } from '../ContextManager';
import { Anthropic } from '@anthropic-ai/sdk';

type Msg = Anthropic.Messages.MessageParam;

/**
 * Helper to generate a sequence of messages.
 * Each message content is repeated 'x ' tokens to simulate token count.
 */
function makeMsgs(count: number, tokensPerMsg = 1): Msg[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x '.repeat(tokensPerMsg).trim(),
  }));
}

describe('ContextManager.getNextTruncationRangeSliding)', () => {
  let ctx: ContextManager;

  beforeEach(() => {
    ctx = new ContextManager();
  });

  it('should return no deletion for empty message array', () => {
    const [s, e] = ctx.getNextTruncationRangeSliding([], undefined, 10);
    expect(s).to.equal(2);
    expect(e).to.equal(1);
  });

  it('should return no deletion for 1 or 2 messages', () => {
    [1, 2].forEach(n => {
      const [s, e] = ctx.getNextTruncationRangeSliding(makeMsgs(n), undefined, 10);
      expect(s).to.equal(2);
      expect(e).to.equal(1);
    });
  });

  it('should return no deletion when total tokens ≤ maxAllowedTokens', () => {
    const msgs = makeMsgs(3, 2); // total tokens = 6
    const [s, e] = ctx.getNextTruncationRangeSliding(msgs, undefined, 10);
    expect(s).to.equal(2);
    expect(e).to.equal(1);
  });

  it('should return no deletion when maxAllowedTokens = 0', () => {
    const msgs = makeMsgs(5, 1);
    const [s, e] = ctx.getNextTruncationRangeSliding(msgs, undefined, 0);
    expect(s).to.equal(2);
    expect(e).to.equal(1);
  });

  it('should remove range correctly when budget < single message token count', () => {
    const msgs = makeMsgs(5, 5); // each message = 5 tokens
    // budget 3 < 5 → cannot keep any, windowStart remains at end
    const [s, e] = ctx.getNextTruncationRangeSliding(msgs, undefined, 3);
    // deleteStart = 2, deleteEnd should adjust to assistant at index 3
    expect(s).to.equal(2);
    expect(e).to.equal(3);
  });

  it('should preserve first pair and start deletion after previous range', () => {
    const msgs = makeMsgs(6, 1);
    const prev: [number, number] = [2, 4];
    // small budget to force deletion
    const [s, e] = ctx.getNextTruncationRangeSliding(msgs, prev, 1);
    expect(s).to.equal(5);
    expect(e).to.be.at.least(s - 1);
  });

  it('should ensure deleteEnd lands on an assistant message', () => {
    // Construct roles: user(0), assistant(1), user(2), assistant(3), user(4)
    const msgs: Msg[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
      { role: 'user', content: 'e' },
    ];
    // budget small so windowStart at end, deleteEnd initially = 4(user) → adjust to 3
    const [s, e] = ctx.getNextTruncationRangeSliding(msgs, undefined, 1);
    expect(s).to.equal(2);
    expect(e).to.equal(3);
  });

  it('should handle currentDeletedRange covering to the end (no further deletion)', () => {
    const msgs = makeMsgs(4, 1);
    const prev: [number, number] = [2, 3]; // already deleted up to last index
    const [s, e] = ctx.getNextTruncationRangeSliding(msgs, prev, 10);
    expect(s).to.equal(4);
    expect(e).to.equal(3);
  });

  it('should expand deletion range correctly across repeated calls', () => {
    const msgs = makeMsgs(8, 1);
    // 1st call: budget 2 → only keep last 2 tokens → windowStart=6 → delete [2..5]
    let [s1, e1] = ctx.getNextTruncationRangeSliding(msgs, undefined, 2);
    expect(s1).to.equal(2);
    expect(e1).to.equal(5);

    // 2nd call: prevRange=[2,5], same budget → deleteStart=6, windowStart remains 6 → no deletion
    let [s2, e2] = ctx.getNextTruncationRangeSliding(msgs, [s1, e1], 2);
    expect(s2).to.equal(6);
    expect(e2).to.equal(5);
  });
});
