export const ONBOARDING_STORAGE_KEY = "geopolis.ui-onboarding.v1";

export function shouldStartOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "complete";
  } catch {
    return true;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
  } catch {
    // UI preference only: storage failure must not block the game.
  }
}
