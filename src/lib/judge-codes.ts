type JudgeCodeInput = {
  access_code?: string | null;
};

const JUDGE_CODE_PATTERN = /^JUDGE-(\d{3,})$/;

export function normalizeJudgeCode(accessCode?: string | null) {
  return accessCode?.trim().toUpperCase() || undefined;
}

function extractJudgeCodeNumber(accessCode?: string | null) {
  const normalized = normalizeJudgeCode(accessCode);
  if (!normalized) return null;
  const match = normalized.match(JUDGE_CODE_PATTERN);
  return match ? Number(match[1]) : null;
}

export function formatJudgeCode(sequence: number) {
  return `JUDGE-${String(sequence).padStart(3, '0')}`;
}

export function assignGeneratedJudgeCodes<T extends JudgeCodeInput>(
  judges: T[],
  existingAccessCodes: Array<string | null | undefined>
): Array<Omit<T, 'access_code'> & { access_code: string }> {
  const usedAccessCodes = new Set(
    existingAccessCodes
      .map(code => normalizeJudgeCode(code))
      .filter((code): code is string => Boolean(code))
  );

  for (const judge of judges) {
    const normalized = normalizeJudgeCode(judge.access_code);
    if (normalized) usedAccessCodes.add(normalized);
  }

  let nextSequence = 1;

  return judges.map(judge => {
    const normalized = normalizeJudgeCode(judge.access_code);
    if (normalized) {
      return {
        ...judge,
        access_code: normalized,
      };
    }

    while (usedAccessCodes.has(formatJudgeCode(nextSequence))) {
      nextSequence += 1;
    }

    const generated = formatJudgeCode(nextSequence);
    usedAccessCodes.add(generated);
    nextSequence += 1;

    return {
      ...judge,
      access_code: generated,
    };
  });
}

export function nextJudgeCode(existingCodes: Array<string | null | undefined>) {
  return assignGeneratedJudgeCodes([{ access_code: undefined }], existingCodes)[0].access_code!;
}

export function maxJudgeCodeNumber(codes: Array<string | null | undefined>) {
  return codes.reduce((max, code) => {
    const value = extractJudgeCodeNumber(code);
    return value && value > max ? value : max;
  }, 0);
}
