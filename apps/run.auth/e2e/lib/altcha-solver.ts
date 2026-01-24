import { solveChallenge } from 'altcha-lib';

interface Challenge {
  algorithm: string;
  challenge: string;
  salt: string;
  maxnumber?: number;
  signature: string;
}

interface AltchaSolution {
  algorithm: string;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
  took: number;
}

export async function fetchAndSolveAltcha(baseUrl: string, regionPrefix: string = '/use1'): Promise<string> {
  // Fetch challenge from server
  const response = await fetch(`${baseUrl}${regionPrefix}/api/captcha/challenge`);
  if (!response.ok) {
    throw new Error(`Failed to fetch challenge: ${response.status}`);
  }

  const challenge: Challenge = await response.json();
  console.log('Challenge received, solving (this may take 2-60 seconds)...');

  // Solve the challenge using altcha-lib
  const { promise } = solveChallenge(
    challenge.challenge,
    challenge.salt,
    challenge.algorithm,
    challenge.maxnumber
  );

  const solution = await promise;
  if (!solution) {
    throw new Error('Failed to solve ALTCHA challenge');
  }

  // Construct the payload (Base64 encoded JSON)
  const payload: AltchaSolution = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number: solution.number,
    salt: challenge.salt,
    signature: challenge.signature,
    took: solution.took,
  };

  // Return Base64 encoded payload (this is what the server expects)
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
