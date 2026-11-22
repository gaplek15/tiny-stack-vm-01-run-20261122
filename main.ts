import * as f from "fs";
import * as p from "path";

function run(prog: Buffer, input: Buffer): { code: number; out: Buffer } {
  const out = Buffer.alloc(65536);
  let outLen = 0, pc = 0, steps = 0, inPtr = 0;
  const stack: number[] = [];
  const callStack: number[] = [];
  const mem = new Int32Array(256);

  const M: Record<number, [number, number, number]> = {
    0: [0, 0, 0], 1: [1, 0, 1], 2: [4, 0, 1], 3: [0, 1, 0], 4: [0, 1, 2], 5: [0, 2, 2], 6: [0, 2, 3], 7: [0, 3, 3],
    16: [0, 2, 1], 17: [0, 2, 1], 18: [0, 2, 1], 19: [0, 2, 1], 20: [0, 2, 1], 21: [0, 2, 1], 22: [0, 2, 1], 23: [0, 1, 1],
    24: [0, 2, 1], 25: [0, 2, 1], 26: [0, 2, 1], 27: [0, 1, 1], 28: [0, 2, 1], 29: [0, 2, 1], 30: [0, 2, 1],
    32: [0, 2, 1], 33: [0, 2, 1], 34: [0, 2, 1],
    48: [2, 0, 0], 49: [2, 1, 0], 50: [2, 1, 0], 51: [2, 0, 0], 52: [0, 0, 0],
    64: [0, 1, 1], 65: [0, 2, 0],
    80: [0, 1, 0], 81: [0, 1, 0], 82: [0, 0, 1], 83: [0, 1, 0]
  };

  const E = (c: number) => ({ code: c, out: out.subarray(0, outLen) });

  while (true) {
    if (steps >= 1000000) return E(10);
    if (pc < 0 || pc >= prog.length) return E(9);
    const op = prog[pc];
    const info = M[op];
    if (!info) return E(5);
    const [imm, pop, push] = info;
    if (pc + 1 + imm > prog.length) return E(9);

    steps++;
    if (stack.length < pop) return E(2);
    if (stack.length - pop + push > 256) return E(3);

    const npc = pc + 1 + imm;

    if (op === 0) return E(0);
    if (op === 1) { stack.push((prog[pc + 1] << 24) >> 24); pc = npc; continue; }
    if (op === 2) { stack.push(prog.readInt32LE(pc + 1)); pc = npc; continue; }
    if (op === 3) { stack.pop(); pc = npc; continue; }
    if (op === 4) { stack.push(stack[stack.length - 1]); pc = npc; continue; }
    if (op === 5) { const b = stack.pop()!, a = stack.pop()!; stack.push(b, a); pc = npc; continue; }
    if (op === 6) { const b = stack.pop()!, a = stack.pop()!; stack.push(a, b, a); pc = npc; continue; }
    if (op === 7) { const c = stack.pop()!, b = stack.pop()!, a = stack.pop()!; stack.push(b, c, a); pc = npc; continue; }

    if (op >= 16 && op <= 34) {
      if (op === 23) { stack.push((-stack.pop()!) | 0); pc = npc; continue; }
      if (op === 27) { stack.push(~stack.pop()!); pc = npc; continue; }
      const b = stack.pop()!, a = stack.pop()!;
      if (op >= 19 && op <= 22 && b === 0) return E(4);
      let r = 0;
      if (op === 16) r = (a + b) | 0;
      else if (op === 17) r = (a - b) | 0;
      else if (op === 18) r = Math.imul(a, b);
      else if (op === 19) r = (a === -2147483648 && b === -1) ? -2147483648 : (a / b) | 0;
      else if (op === 20) r = b === -1 ? 0 : (a % b) | 0;
      else if (op === 21) r = ((a >>> 0) / (b >>> 0)) | 0;
      else if (op === 22) r = ((a >>> 0) % (b >>> 0)) | 0;
      else if (op === 24) r = a & b;
      else if (op === 25) r = a | b;
      else if (op === 26) r = a ^ b;
      else if (op === 28) r = a << (b & 31);
      else if (op === 29) r = a >> (b & 31);
      else if (op === 30) r = (a >>> (b & 31)) | 0;
      else if (op === 32) r = a === b ? 1 : 0;
      else if (op === 33) r = a < b ? 1 : 0;
      else if (op === 34) r = (a >>> 0) < (b >>> 0) ? 1 : 0;
      stack.push(r);
      pc = npc;
      continue;
    }

    if (op >= 48 && op <= 52) {
      const off = op <= 50 ? prog.readInt16LE(pc + 1) : 0;
      if (op === 48) pc = npc + off;
      else if (op === 49) pc = stack.pop()! === 0 ? npc + off : npc;
      else if (op === 50) pc = stack.pop()! !== 0 ? npc + off : npc;
      else if (op === 51) {
        if (callStack.length >= 64) return E(7);
        callStack.push(npc);
        pc = prog.readUInt16LE(pc + 1);
      } else if (op === 52) {
        if (callStack.length === 0) return E(8);
        pc = callStack.pop()!;
      }
      continue;
    }

    if (op === 64) {
      const a = stack.pop()!;
      if (a < 0 || a > 255) return E(6);
      stack.push(mem[a]);
      pc = npc;
      continue;
    }
    if (op === 65) {
      const a = stack.pop()!, v = stack.pop()!;
      if (a < 0 || a > 255) return E(6);
      mem[a] = v;
      pc = npc;
      continue;
    }

    if (op === 80) {
      const s = Buffer.from(String(stack.pop()! | 0));
      if (outLen + s.length > 65536) return E(11);
      s.copy(out, outLen);
      outLen += s.length;
      pc = npc;
      continue;
    }
    if (op === 81) {
      const v = stack.pop()!;
      if (outLen + 1 > 65536) return E(11);
      out[outLen++] = v & 255;
      pc = npc;
      continue;
    }
    if (op === 82) {
      stack.push(inPtr < input.length ? input[inPtr++] : -1);
      pc = npc;
      continue;
    }
    if (op === 83) {
      return E(stack.pop()! & 255);
    }
  }
}

for (let i = 1; i <= 40; i++) {
  const id = "i" + String(i).padStart(3, "0");
  const inDir = p.join("/input", id);
  const outDir = p.join("/output", id);
  f.mkdirSync(outDir, { recursive: true });
  try {
    const prog = f.readFileSync(p.join(inDir, "program.bin"));
    const input = f.readFileSync(p.join(inDir, "input.bin"));
    const res = run(prog, input);
    f.writeFileSync(p.join(outDir, "stdout.bin"), res.out);
    f.writeFileSync(p.join(outDir, "exit.txt"), res.code + "\n");
  } catch {
    f.writeFileSync(p.join(outDir, "stdout.bin"), Buffer.alloc(0));
    f.writeFileSync(p.join(outDir, "exit.txt"), "0\n");
  }
}
