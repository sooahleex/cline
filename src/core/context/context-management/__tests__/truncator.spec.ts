import 'module-alias/register';
import { ContextManager } from "../ContextManager"
import { Anthropic } from "@anthropic-ai/sdk"
import { expect } from "chai"

// 더미 메시지 생성 유틸
function makeMessages(count: number): Anthropic.Messages.MessageParam[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg${i}`,  // 토큰 길이 테스트용
  }));
}

describe("ContextManager.getNextTruncationRange", () => {
  let ctxMgr: ContextManager;

  beforeEach(() => {
    ctxMgr = new ContextManager();
  });

  it("예산(maxTokens)보다 전체 토큰이 적으면 삭제 구간 없음", () => {
    const msgs = makeMessages(2);    // 토큰 합도 2
    // currentDeletedRange: undefined, maxAllowedTokens: 10
    const [start, end] = ctxMgr.getNextTruncationRangeSliding(msgs, undefined, 10);
    expect(start).to.equal(2);
    expect(end).to.equal(1);         // start > end 이면 "삭제 없음"
  });

  it("이미 삭제된 범위가 있을 때, 그 다음 인덱스부터 삭제가 시작됨", () => {
    const msgs = makeMessages(6);
    // 예) 이전에 2~3번 인덱스를 삭제했다고 치고
    const prevRange: [number, number] = [2, 3];
    // 토큰 예산을 매우 작게 잡아서 추가 삭제 유도
    const [start, end] = ctxMgr.getNextTruncationRangeSliding(msgs, prevRange, 1);
    expect(start).to.equal(4);       // prevRange[1] + 1
    // end는 start-1 이상(혹은 start) 이면 OK
    expect(end).to.be.at.least(start - 1);
  });

  it("슬라이딩 윈도우로 토큰 예산에 맞춰 뒤쪽 메시지를 유지", () => {
    // 5개의 메시지를 만들고, 각 content 길이는 4토큰이라고 가정
    const msgs = makeMessages(5).map(m => ({ ...m, content: "a b c d" }));
    // maxAllowedTokens = 8 → 뒤에서 두 개(총 8토큰)만 유지
    const [start, end] = ctxMgr.getNextTruncationRangeSliding(msgs, undefined, 8);
    // deleteStart = 2, deleteEnd = windowStart-1 = 3 → [2,3] 이 잘 나와야 함
    expect(start).to.equal(2);
    expect(end).to.equal(3);
  });
});
