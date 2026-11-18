// Helpers for artillery.yml: each virtual user is a brand-new person on a brand-new "client IP"
// (the API trusts one proxy hop, so X-Forwarded-For stands in for real devices; without it every
// virtual user would share one rate-limit bucket and the test would only measure the throttler).
let counter = 0;

function rnd(n) { return Math.floor(Math.random() * n); }

module.exports = {
  addIp(req, ctx, _events, next) {
    req.headers = { ...(req.headers || {}), 'X-Forwarded-For': ctx.vars.ip || `10.0.0.${1 + rnd(250)}` };
    return next();
  },

  newPerson(ctx, _events, done) {
    counter += 1;
    const tail = String((Date.now() + counter * 7919 + rnd(1000)) % 10_000_000).padStart(7, '0');
    ctx.vars.phone = `0311${tail}`;
    ctx.vars.password = 'load-Test-4242';
    ctx.vars.deviceId = `load-device-${Date.now()}-${counter}`;
    ctx.vars.ip = `10.${rnd(250)}.${rnd(250)}.${1 + rnd(250)}`;
    ctx.vars.idemKey = `load-${Date.now()}-${counter}-${rnd(1e6)}`;
    return done();
  },
};
