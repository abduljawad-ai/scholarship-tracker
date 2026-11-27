export const APP_NAME = "Scholarship Tracker"
export const PUBLIC_REPO_URL = "https://github.com/abduljawad-ai/scholarship-tracker"

export const STUDY_LEVELS = ["matric", "intermediate", "bachelor", "master", "phd"] as const
export type StudyLevel = (typeof STUDY_LEVELS)[number]

export const VERIFICATION_STATUSES = ["verified", "provisional", "unverified"] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const CYCLE_STATUSES = ["open", "upcoming", "closed", "archived"] as const
export type CycleStatus = (typeof CYCLE_STATUSES)[number]

export const PROVIDER_TYPES = ["gov", "university", "foundation", "org"] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

export const FUNDING_TYPES = ["fully-funded", "stipend", "tuition", "partial"] as const
export type FundingType = (typeof FUNDING_TYPES)[number]

export const SOURCE_TYPES = ["official-page", "official-pdf", "official-facebook", "aggregator"] as const
export type SourceType = (typeof SOURCE_TYPES)[number]
