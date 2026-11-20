// Plays "the other person" for a phone flow, through the real API (Maestro's JavaScript, ES5 style).
// The phone drives ONE person on screen; this script does what the other side would do at that moment.
// Run with:  - runScript: { file: helpers/api.js, env: { ACTION: workerOffers } }
// Needs (from the flow's env): API (e.g. http://10.0.2.2:3002/api), ACTION, and the accounts below.
// The same file is exercised without a phone by helpers/check.mjs, so a typo here shows up in CI.

var PASSWORD = typeof PASSWORD_E2E === 'undefined' ? 'Maestro-pass-42' : PASSWORD_E2E;
var CUSTOMER = typeof CUSTOMER_PHONE === 'undefined' ? '+923009990001' : CUSTOMER_PHONE;
var WORKER = typeof WORKER_PHONE === 'undefined' ? '+923009990002' : WORKER_PHONE;

function call(method, path, token, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = http.request(API + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
  var parsed = res.body ? json(res.body) : null;
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + res.body);
  return parsed;
}

function login(phone) {
  return call('POST', '/auth/login', null, { phone: phone, countryCode: 'PK', password: PASSWORD, deviceId: 'maestro-helper-' + phone.slice(-4) }).token;
}

function firstItems(page) { return page.items || page; }

function latestJob(token) {
  var jobs = firstItems(call('GET', '/job-requests', token));
  if (!jobs.length) throw new Error('no request found');
  return jobs[0];
}

var actions = {
  // Ids for opening the request screen by link: fixli:///request-service?categoryId=..&issue=..
  catalog: function () {
    var cats = call('GET', '/service-catalog/categories');
    var plumbing = null;
    for (var i = 0; i < cats.length; i++) if (cats[i].name === 'PLUMBING') plumbing = cats[i];
    if (!plumbing || !plumbing.issues.length) throw new Error('catalogue is not seeded');
    output.categoryId = plumbing.id;
    output.issue = plumbing.issues[0].code;
  },

  // The customer sends a request (used when the phone is the worker).
  customerRequests: function () {
    var token = login(CUSTOMER);
    var cats = call('GET', '/service-catalog/categories');
    var plumbing = null;
    for (var i = 0; i < cats.length; i++) if (cats[i].name === 'PLUMBING') plumbing = cats[i];
    var addresses = call('GET', '/addresses', token);
    var job = call('POST', '/job-requests', token, {
      categoryId: plumbing.id, issueCodes: [plumbing.issues[0].code], addressId: firstItems(addresses)[0].id,
      when: 'TODAY', idempotencyKey: 'maestro-' + Date.now() + '-request',
    });
    output.jobId = job.id;
  },

  // A worker sends a price for every request sent to them.
  workerOffers: function () {
    var token = login(WORKER);
    var sent = 0;
    for (var attempt = 0; attempt < 10 && sent === 0; attempt++) {
      var feed = call('GET', '/workers/me/requests', token);
      for (var i = 0; i < feed.length; i++) {
        if (feed[i].myOffer && feed[i].myOffer.status === 'PENDING') { sent++; continue; }
        call('POST', '/job-requests/' + feed[i].id + '/offers', token, { amount: 150000, etaMinutes: 30 });
        sent++;
      }
    }
    if (!sent) throw new Error('the worker was not sent any request');
  },

  // The customer books the first price on their latest request.
  customerBooks: function () {
    var token = login(CUSTOMER);
    var job = latestJob(token);
    var offers = call('GET', '/job-requests/' + job.id + '/offers', token);
    if (!offers.length) throw new Error('no price to book');
    call('POST', '/offers/' + offers[0].id + '/accept', token);
    output.jobId = job.id;
  },

  // The worker drives the job to "finished" (no photo: says why instead, the camera is not on the emulator).
  workerCompletes: function () {
    var token = login(WORKER);
    var jobs = firstItems(call('GET', '/job-requests?group=active', token));
    if (!jobs.length) throw new Error('the worker has no booked job');
    var id = jobs[0].id;
    var steps = ['en-route', 'arrive'];
    for (var i = 0; i < steps.length; i++) call('POST', '/job-requests/' + id + '/' + steps[i], token, {});
    call('POST', '/job-requests/' + id + '/start', token, { photoSkipReason: 'NOT_APPLICABLE' });
    call('POST', '/job-requests/' + id + '/finish', token, { photoSkipReason: 'NOT_APPLICABLE' });
    output.jobId = id;
  },

  // Worker marks cash received; the customer confirms it (used by the customer's closing steps).
  workerMarksCash: function () {
    var token = login(WORKER);
    var jobs = firstItems(call('GET', '/job-requests?group=active', token));
    call('POST', '/job-requests/' + jobs[0].id + '/payments/cash', token, {});
  },

  // The customer confirms the finished work (used when the phone is the worker).
  customerConfirms: function () {
    var token = login(CUSTOMER);
    var job = latestJob(token);
    call('POST', '/job-requests/' + job.id + '/confirm', token, {});
  },
};

if (!actions[ACTION]) throw new Error('unknown ACTION ' + ACTION);
actions[ACTION]();
