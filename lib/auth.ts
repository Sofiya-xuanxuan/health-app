// 上线是公网，用一个口令挡住陌生人（否则别人乱点会烧你的 API 额度）
// 本地/未设 APP_PASSPHRASE 时不拦，方便开发
export function authed(req: Request): boolean {
  const pass = process.env.APP_PASSPHRASE
  if (!pass) return true
  return req.headers.get('x-app-pass') === pass
}
