/** Test tools (preview date, example history, delete all) exist only in dev and the shareable preview build. */
export const DEV_TOOLS = import.meta.env.DEV || import.meta.env.MODE === 'single'
