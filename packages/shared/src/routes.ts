// ============================================================
// App screen paths used in notifications and deep links. The server builds links only through
// these, and an app test checks every one maps to a real screen file (doc 26 7.7: a chat push
// once pointed at a screen that didn't exist).
// ============================================================

export const routes = {
  customerJob: (jobId: string) => `/(customer)/job/${jobId}`,
  workerJob: (jobId: string) => `/(worker)/job/${jobId}`,
  /** The job screen for whichever side this user is on. */
  jobFor: (jobId: string, side: 'customer' | 'worker') => (side === 'customer' ? routes.customerJob(jobId) : routes.workerJob(jobId)),
  thread: (conversationId: string) => `/thread/${conversationId}`,
  workerJobs: () => '/(worker)/jobs',
  workerToday: () => '/(worker)/today',
  workerEarnings: () => '/(worker)/earnings',
  workerDocuments: () => '/(worker-setup)/setup/documents',
} as const;

/** Route patterns, for the app's "every link has a screen" test: `:id` stands for any segment. */
export const ROUTE_PATTERNS = [
  '/(customer)/job/:id',
  '/(worker)/job/:id',
  '/thread/:id',
  '/(worker)/jobs',
  '/(worker)/today',
  '/(worker)/earnings',
  '/(worker-setup)/setup/documents',
] as const;
