// Apps Script web app on the wearer's Google account. It sends the requester a
// calendar invite and reports the wearer's busy times for scheduling.
// Paste into a new project at script.google.com, run `authorize` once, then
// Deploy > New deployment > Web app, execute as Me, access Anyone.
// Put the /exec URL in bridge/.env as INVITE_SCRIPT_URL.

function authorize() {
  CalendarApp.getDefaultCalendar()
}

function doPost(e) {
  var req = JSON.parse(e.postData.contents)
  var cal = CalendarApp.getDefaultCalendar()
  if (req.op === 'invite') {
    var start = new Date(req.start)
    var end = new Date(start.getTime() + (req.minutes || 90) * 60000)
    var ev = cal.createEvent(req.title, start, end, {
      location: req.location || '',
      description: req.description || '',
      guests: req.guest,
      sendInvites: true,
    })
    return json({ ok: true, id: ev.getId() })
  }
  if (req.op === 'busy') {
    var busy = cal.getEvents(new Date(req.from), new Date(req.to))
      .filter(function (ev) { return !ev.isAllDayEvent() })
      .map(function (ev) { return [ev.getStartTime().toISOString(), ev.getEndTime().toISOString()] })
    return json({ ok: true, busy: busy })
  }
  return json({ ok: false })
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)
}
