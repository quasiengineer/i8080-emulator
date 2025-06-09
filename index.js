import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { Computer } from './computer.js';
import { Device } from './device.js'

const TICKS_PER_SECOND = 3_125_000n;

class ConsoleDevice extends Device {
  constructor(prefixOutput, computer) {
    super();
    this._prefixOutput = prefixOutput;
    this._computer = computer;
  }

  Write(_, val) {
    if (val === 0x05) {
      console.log(`\nCurrent time: ${Date.now()}ms\n`);
      return;
    }

    if (val === 0x06) {
      console.log(`\nCurrent ticks: ${this._computer.CPUState.Clock} ticks\n`);
      return;
    }

    const ch = String.fromCharCode(val);

    if (this._prefixOutput) {
      console.log(`[output] ${ch}`);
    } else {
      process.stdout.write(ch);
    }
  }
}

class TutorialComputer extends Computer {
  constructor(cpu, options) {
    super(cpu);
    this._consoleDevice = new ConsoleDevice(options?.prefixOutput, this);
    this._bus.ConnectDeviceToWritePort(0x01, this._consoleDevice);
  }
}

const loadSymbolsMap = (prgPath) => {
  const prgDir = path.dirname(prgPath);
  const prgName = path.basename(prgPath);
  const symbolsMapText = fs.readFileSync(path.join(prgDir, `${prgName}.map`), 'utf-8');
  const symbolsMap = {};

  for (const symbolDescription of symbolsMapText.split('\n')) {
    const [, symbolName, value, type] = symbolDescription.match(/([\w_]+)\s*=\s*\$([0-9A-F]+)\s*;\s*(\w+)/) || [];
    if (type === 'addr') {
      if (!symbolsMap[parseInt(value, 16)]) {
        symbolsMap[parseInt(value, 16)] = symbolName;
      }
    }
  }

  return symbolsMap;
};

const profileProgram = (prgPath, computer) => {
  const symbolsMap = loadSymbolsMap(prgPath);
  const stacktraces = new Map();
  const calls = new Map();
  const currentStack = [];
  let shortTrace = [];

  while (!computer.CPUState.Halt) {
    const {
      CPUState: { ProgramCounter: pc, Clock: ticks },
      InstructionMeta,
      LastInstructionAddress,
      LastInstructionDisassembly,
    } = computer.ExecuteNextInstruction();

    // last 5 instruction executed
    shortTrace = [...shortTrace, LastInstructionDisassembly].slice(-5);

    const sp = computer.CPUState.StackPointer;
    const returnAddress = computer._mmu.RAM[sp] + (computer._mmu.RAM[sp + 1] << 8);
    // need to speculate if there is pseudo-call instruction: JUMP + address to return in stack
    if (InstructionMeta.callPerformed || (InstructionMeta.jumpPerformed && returnAddress == LastInstructionAddress + InstructionMeta.size)) {
      const fnName = symbolsMap[pc] || 'unknown';
      calls.set(fnName, (calls.get(fnName) || 0n) + 1n);
      currentStack.push({ name: fnName, entranceCycle: ticks, subroutinesExecutionCycles: 0n, returnAddress });
    } else if (InstructionMeta.returnPerformed || (InstructionMeta.jumpPerformed && currentStack.at(-1)?.returnAddress === pc)) {
      // recognize JUMP pattern, that is done via push/ret combination
      if (shortTrace.at(-1) === 'RET' && shortTrace.at(-2)?.startsWith('PUSH')) {
        continue;
      }
      const stacktrace = currentStack.map(({ name }) => name).join(';');
      const { entranceCycle, subroutinesExecutionCycles } = currentStack.pop();
      const fnTotalExecutionCycles = ticks - entranceCycle;
      const fnRawExecutionCycles = fnTotalExecutionCycles - subroutinesExecutionCycles;
      const stacktraceCycles = (stacktraces.get(stacktrace) || 0n) + fnRawExecutionCycles;
      stacktraces.set(stacktrace, stacktraceCycles);
      const parent = currentStack.at(-1);
      if (parent) {
        parent.subroutinesExecutionCycles += fnTotalExecutionCycles;
      }
    }
  }

  const { Clock: ticks }  = computer.CPUState;
  console.log();
  console.log(`Ticks = ${ticks}, seconds = ${Math.round(Number(ticks / TICKS_PER_SECOND))}`);
  console.log('Calls:');
  const sortedCalls = [...calls.entries()].sort((a, b) => Number(b[1] - a[1]));
  console.log(sortedCalls.map(([functionName, times]) => `  ${functionName} ${times}`).join('\n'));
  console.log();
  console.log('Stacktraces:');
  console.log([...stacktraces.entries()].map(([stacktrace, cycles]) => `${stacktrace} ${cycles}`).join('\n'));
}

const debugProgram = (computer) => {
  const rl = readline.createInterface(process.stdin, process.stdout);
  rl.setPrompt('> ');
  rl.prompt();

  const printInfo = (instrAddr, instrDisasm) => console.log(`  <${instrAddr.toString(16)}> ${instrDisasm}`);

  const breakpoints = new Set();
  rl.on('line', (line) => {
    const cmdRaw = line.trim();
    const cmdParts = cmdRaw.split(/\s+/).filter(Boolean);
    switch (cmdParts[0]) {
      case 'bp':
        breakpoints.add(parseInt(cmdParts[1], 16));
        break;

      case 'mrw': {
        const addr = parseInt(cmdParts[1], 16);
        const value = computer._mmu.RAM[addr] + (computer._mmu.RAM[addr + 1] << 8);
        console.log(`  memory word at address ${addr.toString(16)} = ${value.toString(16)}`);
        break;
      }

      case 'mr': {
        const addr = parseInt(cmdParts[1], 16);
        const len = parseInt(cmdParts[2], 16);
        const values = [];
        for (let i = 0; i < len; ++i) {
          values.push(computer._mmu.RAM[addr + i] || 0);
        }
        console.log(`  memory at address ${addr.toString(16)} = ${values.map((x) => x.toString(16)).join(' ')}`);
        break;
      }

      case 'mrb': {
        const addr = parseInt(cmdParts[1], 16);
        console.log(`  memory byte at address ${addr.toString(16)} = ${computer._mmu.RAM[addr].toString(16)}`);
        break;
      }

      case 'regs': {
        const sp = computer.CPUState.StackPointer;
        const regs = computer.CPUState.Registers;
        console.log(`    SP = ${sp.toString(16)} H = ${regs.H.toString(16)} L = ${regs.L.toString(16)}`);
        console.log(`    A = ${regs.A.toString(16)} D = ${regs.D.toString(16)} B = ${regs.B.toString(16)}`);
        break;
      }

      case 'run': {
        while (!computer.CPUState.Halt) {
          const { CPUState: { ProgramCounter: pc }, LastInstructionDisassembly, LastInstructionAddress } = computer.ExecuteNextInstruction();
          if (breakpoints.has(pc)) {
            printInfo(LastInstructionAddress, LastInstructionDisassembly);
            break;
          }
        }
        break;
      }

      case 'n':
        const { LastInstructionDisassembly, LastInstructionAddress } = computer.ExecuteNextInstruction();
        printInfo(LastInstructionAddress, LastInstructionDisassembly);
        break;
    }

    rl.prompt();
  }).on('close', () => process.exit(0));

};

const runProgram = (computer) => {
  while (!computer.CPUState.Halt) {
    computer.ExecuteNextInstruction();
  }

  const { Clock: ticks }  = computer.CPUState;
  console.log(`Ticks = ${ticks}, seconds = ${Math.round(Number(ticks / TICKS_PER_SECOND))}`);
};

(function main() {
  const [prgFile, mode] = process.argv.slice(2);
  const profile = mode === '--profile';
  const debug = mode === '--debug';

  const computer = new TutorialComputer('i8080', { prefixOutput: debug === true });
  const prgPath = path.resolve(prgFile);
  const program = Array.from(fs.readFileSync(prgPath));
  computer.LoadProgram(program);

  if (profile) {
    profileProgram(prgPath, computer);
  } else if (debug) {
    debugProgram(computer)
  } else {
    runProgram(computer);
  }
}());