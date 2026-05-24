import { useMemo } from "react";

const ECC_CODEWORDS_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

const NUM_ERROR_CORRECTION_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
  18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const getSize = (version: number) => version * 4 + 17;

const getNumRawDataModules = (version: number) => {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
};

const getDataCapacityBytes = (version: number) => {
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const eccCodewords = ECC_CODEWORDS_PER_BLOCK_M[version] * NUM_ERROR_CORRECTION_BLOCKS_M[version];
  return rawCodewords - eccCodewords;
};

const appendBits = (bits: number[], value: number, length: number) => {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
};

const bitsToBytes = (bits: number[]) => {
  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] || 0);
    result.push(value);
  }
  return result;
};

const multiply = (x: number, y: number) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};

const computeDivisor = (degree: number) => {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = multiply(root, 2);
  }
  return result;
};

const computeRemainder = (data: number[], divisor: number[]) => {
  const result = Array(divisor.length).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= multiply(divisor[i], factor);
  }
  return result;
};

const addEccAndInterleave = (data: number[], version: number) => {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_M[version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const shortBlockDataLen = shortBlockLen - blockEccLen;
  const divisor = computeDivisor(blockEccLen);
  const blocks: number[][] = [];
  let offset = 0;

  for (let i = 0; i < numBlocks; i++) {
    const dataLength = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
    const blockData = data.slice(offset, offset + dataLength);
    offset += dataLength;
    const ecc = computeRemainder(blockData, divisor);
    if (i < numShortBlocks) blockData.push(0);
    blocks.push(blockData.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockDataLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
};

const getAlignmentPositions = (version: number) => {
  if (version === 1) return [];
  const size = getSize(version);
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
};

const makeMatrix = (size: number) => ({
  modules: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
  isFunction: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
});

const setFunctionModule = (
  modules: boolean[][],
  isFunction: boolean[][],
  x: number,
  y: number,
  dark: boolean,
) => {
  const size = modules.length;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  modules[y][x] = dark;
  isFunction[y][x] = true;
};

const drawFinderPattern = (modules: boolean[][], isFunction: boolean[][], x: number, y: number) => {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const dark = distance !== 2 && distance !== 4;
      setFunctionModule(modules, isFunction, x + dx, y + dy, dark);
    }
  }
};

const drawAlignmentPattern = (modules: boolean[][], isFunction: boolean[][], x: number, y: number) => {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunctionModule(modules, isFunction, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
};

const drawVersion = (modules: boolean[][], isFunction: boolean[][], version: number) => {
  if (version < 7) return;
  const size = modules.length;
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (version << 12) | remainder;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(modules, isFunction, a, b, dark);
    setFunctionModule(modules, isFunction, b, a, dark);
  }
};

const drawFormat = (modules: boolean[][], isFunction: boolean[][], mask: number) => {
  const size = modules.length;
  const data = mask; // Error correction level M has format bits 00.
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunctionModule(modules, isFunction, 8, i, ((bits >>> i) & 1) !== 0);
  setFunctionModule(modules, isFunction, 8, 7, ((bits >>> 6) & 1) !== 0);
  setFunctionModule(modules, isFunction, 8, 8, ((bits >>> 7) & 1) !== 0);
  setFunctionModule(modules, isFunction, 7, 8, ((bits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunctionModule(modules, isFunction, 14 - i, 8, ((bits >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i++) setFunctionModule(modules, isFunction, size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunctionModule(modules, isFunction, 8, size - 15 + i, ((bits >>> i) & 1) !== 0);
  setFunctionModule(modules, isFunction, 8, size - 8, true);
};

const drawFunctionPatterns = (modules: boolean[][], isFunction: boolean[][], version: number) => {
  const size = modules.length;
  drawFinderPattern(modules, isFunction, 3, 3);
  drawFinderPattern(modules, isFunction, size - 4, 3);
  drawFinderPattern(modules, isFunction, 3, size - 4);

  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunctionModule(modules, isFunction, i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunctionModule(modules, isFunction, 6, i, i % 2 === 0);
  }

  const positions = getAlignmentPositions(version);
  for (const y of positions) {
    for (const x of positions) {
      if (!isFunction[y][x]) drawAlignmentPattern(modules, isFunction, x, y);
    }
  }

  drawVersion(modules, isFunction, version);
};

const drawCodewords = (modules: boolean[][], isFunction: boolean[][], data: number[]) => {
  const size = modules.length;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!isFunction[y][x]) {
          const dark = bitIndex < data.length * 8 && (((data[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0);
          modules[y][x] = dark;
          bitIndex++;
        }
      }
    }
  }
};

const maskBit = (mask: number, x: number, y: number) => {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return false;
  }
};

const applyMask = (modules: boolean[][], isFunction: boolean[][], mask: number) => {
  const result = modules.map((row) => row.slice());
  for (let y = 0; y < result.length; y++) {
    for (let x = 0; x < result.length; x++) {
      if (!isFunction[y][x] && maskBit(mask, x, y)) result[y][x] = !result[y][x];
    }
  }
  return result;
};

const finderPenalty = (bits: boolean[], index: number) => {
  const pattern = [true, false, true, true, true, false, true];
  for (let i = 0; i < pattern.length; i++) {
    if (bits[index + i] !== pattern[i]) return 0;
  }

  const leftLight = index >= 4 && !bits[index - 1] && !bits[index - 2] && !bits[index - 3] && !bits[index - 4];
  const rightLight =
    index + 11 <= bits.length &&
    !bits[index + 7] &&
    !bits[index + 8] &&
    !bits[index + 9] &&
    !bits[index + 10];
  return leftLight || rightLight ? PENALTY_N3 : 0;
};

const getPenaltyScore = (modules: boolean[][]) => {
  const size = modules.length;
  let result = 0;

  for (let y = 0; y < size; y++) {
    let runColor = false;
    let runLength = 0;
    for (let x = 0; x < size; x++) {
      if (x === 0 || modules[y][x] !== runColor) {
        runColor = modules[y][x];
        runLength = 1;
      } else {
        runLength++;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result++;
      }
    }
  }

  for (let x = 0; x < size; x++) {
    let runColor = false;
    let runLength = 0;
    for (let y = 0; y < size; y++) {
      if (y === 0 || modules[y][x] !== runColor) {
        runColor = modules[y][x];
        runLength = 1;
      } else {
        runLength++;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result++;
      }
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x <= size - 7; x++) result += finderPenalty(modules[y], x);
  }
  for (let x = 0; x < size; x++) {
    const column = modules.map((row) => row[x]);
    for (let y = 0; y <= size - 7; y++) result += finderPenalty(column, y);
  }

  const dark = modules.flat().filter(Boolean).length;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += Math.max(0, k) * PENALTY_N4;
  return result;
};

const encodeData = (value: string, version: number) => {
  const bytes = Array.from(new TextEncoder().encode(value));
  const countBits = version < 10 ? 8 : 16;
  const capacity = getDataCapacityBytes(version);
  const bits: number[] = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, countBits);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacityBits = capacity * 8;
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = bitsToBytes(bits);
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  return data;
};

export const createQrMatrix = (value: string) => {
  const bytesLength = new TextEncoder().encode(value).length;
  let version = 1;
  for (; version <= 40; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + bytesLength * 8 <= getDataCapacityBytes(version) * 8) break;
  }
  if (version > 40) throw new Error("QR data is too long");

  const data = addEccAndInterleave(encodeData(value, version), version);
  const size = getSize(version);
  const { modules, isFunction } = makeMatrix(size);
  drawFunctionPatterns(modules, isFunction, version);
  drawCodewords(modules, isFunction, data);

  let bestModules: boolean[][] | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(modules, isFunction, mask);
    drawFormat(masked, isFunction, mask);
    const penalty = getPenaltyScore(masked);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestModules = masked;
    }
  }

  return bestModules ?? modules;
};

interface LocalQrCodeProps {
  value: string;
  title?: string;
  className?: string;
}

const LocalQrCode = ({ value, title = "QR code", className }: LocalQrCodeProps) => {
  const modules = useMemo(() => createQrMatrix(value), [value]);
  const size = modules.length;
  const quietZone = 4;
  const viewBoxSize = size + quietZone * 2;
  const path = modules
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x + quietZone},${y + quietZone}h1v1h-1z` : "")),
    )
    .join("");

  return (
    <svg
      aria-label={title}
      role="img"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
};

export default LocalQrCode;
