import { GoogleGenAI, Type } from '@google/genai';
import type { CategoryKey } from '../src/types/game.ts';

export interface EntryCandidate {
  cacheKey: string;
  category: CategoryKey;
  word: string;
}

export interface VerifiedEntryVerdict {
  isValid: boolean;
  reasonCode: 'valid' | 'not_english' | 'not_real' | 'wrong_category';
  note: string;
}

const verificationCache = new Map<string, VerifiedEntryVerdict>();

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Check your Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyRoundEntries(
  candidates: EntryCandidate[]
): Promise<Map<string, VerifiedEntryVerdict>> {
  const results = new Map<string, VerifiedEntryVerdict>();
  const uncached: EntryCandidate[] = [];

  for (const item of candidates) {
    const cached = verificationCache.get(item.cacheKey);
    if (cached) {
      results.set(item.cacheKey, cached);
    } else {
      uncached.push(item);
    }
  }

  if (uncached.length === 0) {
    return results;
  }

  const ai = getGeminiClient();

  const indexedItems = uncached.map((c, idx) => ({
    id: String(idx),
    category: c.category,
    word: c.word,
  }));

  const prompt = [
    'Verify each submitted entry for an English-language game of "Name, Place, Animal, Thing".',
    'Rules for isValid = true:',
    '1. The item MUST exist in the real world (not gibberish, keyboard mashing, invented nonsense, or purely fictional fantasy creatures/places like "Dragon", "Unicorn", "Hogwarts").',
    '2. The entry MUST be valid in English (English words for animals/things, or internationally recognized real-world proper names/places in standard English/Latin script). Reject foreign-language common nouns written in Roman script (e.g. "Billi", "Kursi", "Kutta", "Pani", "Ghar") as not_english.',
    '3. It MUST accurately match its category:',
    '   - "name": A real human first name, surname, or real person name.',
    '   - "place": A real-world geographic place (country, city, town, river, mountain, continent, landmark).',
    '   - "animal": A real-world animal, bird, fish, insect, reptile, or mammal in English.',
    '   - "thing": A real-world tangible object, item, food, vehicle, tool, or material in English.',
    '4. Minor obvious harmless plural/casing is fine, but clear misspellings that are not real words or gibberish must be rejected.',
    '',
    'Entries to verify:',
    JSON.stringify(indexedItems),
  ].join('\n');

  const attemptErrors: string[] = [];
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptStart = Date.now();
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            systemInstruction:
              'You are a strict, accurate English fact-checker for the tabletop word game Name, Place, Animal, Thing. Return only structured JSON verdicts.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  isValid: { type: Type.BOOLEAN },
                  reasonCode: {
                    type: Type.STRING,
                    description:
                      'One of: valid, not_english, not_real, wrong_category',
                  },
                  note: {
                    type: Type.STRING,
                    description:
                      'Short 2-6 word plain English explanation, e.g. "Real English animal", "Not a real-world item", "Not an English word", "Wrong category"',
                  },
                },
                required: ['id', 'isValid', 'reasonCode', 'note'],
              },
            },
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Verification timed out after 12s.')),
            12_000
          )
        ),
      ]);

      const rawText = (response.text ?? '[]').trim();
      const parsed = JSON.parse(rawText) as Array<{
        id: string;
        isValid: boolean;
        reasonCode: string;
        note: string;
      }>;

      for (const row of parsed) {
        const idx = Number(row.id);
        const candidate = uncached[idx];
        if (!candidate) continue;

        const reasonCode: VerifiedEntryVerdict['reasonCode'] = row.isValid
          ? 'valid'
          : row.reasonCode === 'not_english' ||
            row.reasonCode === 'wrong_category'
          ? row.reasonCode
          : 'not_real';

        const verdict: VerifiedEntryVerdict = {
          isValid: Boolean(row.isValid),
          reasonCode,
          note: (row.note || (row.isValid ? 'Verified real item' : 'Not a valid English item')).slice(
            0,
            48
          ),
        };

        verificationCache.set(candidate.cacheKey, verdict);
        results.set(candidate.cacheKey, verdict);
      }

      // Ensure every uncached item has a verdict if any id was omitted
      for (const candidate of uncached) {
        if (!results.has(candidate.cacheKey)) {
          const fallback: VerifiedEntryVerdict = {
            isValid: false,
            reasonCode: 'not_real',
            note: 'Could not verify as real English item',
          };
          results.set(candidate.cacheKey, fallback);
        }
      }

      return results;
    } catch (err) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      attemptErrors.push(`Attempt ${attempt + 1} (${Date.now() - attemptStart}ms): ${errMsg}`);
      console.error(
        `[verifyEntries] attempt ${attempt + 1} failed after ${Date.now() - attemptStart}ms:`,
        errMsg
      );
      if (attempt < 1) {
        await sleep(350);
      }
    }
  }

  const summary = attemptErrors.join(' | ');
  throw new Error(
    summary ||
      (lastError instanceof Error
        ? lastError.message
        : 'Failed to verify answers with Gemini API.')
  );
}
