// Apps Script web app on the wearer's Google account. It sends the requester a
// calendar invite, reports the wearer's busy times, edits the demo deck, and
// finds and sends Drive files.
// Paste into a new project at script.google.com, run `authorize` once, then
// Deploy > New deployment > Web app, execute as Me, access Anyone.
// Put the /exec URL in bridge/.env as INVITE_SCRIPT_URL.

function authorize() {
  CalendarApp.getDefaultCalendar()
  DriveApp.getRootFolder()
  SlidesApp.openById(DriveApp.getFilesByType(MimeType.GOOGLE_SLIDES).next().getId())
  MailApp.getRemainingDailyQuota()
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
  if (req.op === 'outline') return json({ ok: true, slides: outline(SlidesApp.openById(req.deck)) })
  if (req.op === 'apply') {
    var deck = SlidesApp.openById(req.deck)
    var last = null
    req.edits.forEach(function (ed) { last = apply(deck, ed) || last })
    return json({ ok: true, slide: last && last.getObjectId() })
  }
  if (req.op === 'find') return json({ ok: true, files: find(req.keywords || []) })
  if (req.op === 'share') return json({ ok: share(req) })
  return json({ ok: false })
}

function outline(deck) {
  return deck.getSlides().map(function (s, i) {
    return {
      n: i + 1,
      id: s.getObjectId(),
      texts: s.getShapes()
        .filter(function (sh) { return sh.getText().asString().trim() || sh.getPlaceholderType() !== SlidesApp.PlaceholderType.NONE })
        .map(function (sh) {
          var o = { id: sh.getObjectId(), text: sh.getText().asString().trim() }
          if (!o.text) o.empty = String(sh.getPlaceholderType())
          return o
        }),
    }
  })
}

function apply(deck, ed) {
  if (ed.op === 'setText' || ed.op === 'addBullet') {
    var sh = shape(deck, ed.shapeId)
    if (!sh) return null
    if (ed.op === 'setText') sh.getText().setText(ed.text)
    else sh.getText().appendParagraph(ed.text)
    return sh.getParentPage()
  }
  if (ed.op === 'replace') {
    var s = deck.getSlides()[ed.slide - 1]
    if (!s) return null
    s.replaceAllText(ed.find, ed.replace)
    return s
  }
  if (ed.op === 'addSlide') {
    var ns = deck.insertSlide(Math.min(ed.after, deck.getSlides().length), SlidesApp.PredefinedLayout.TITLE_AND_BODY)
    title(ns, ed.title)
    var body = ns.getPlaceholder(SlidesApp.PlaceholderType.BODY)
    if (body) body.asShape().getText().setText(ed.body)
    return ns
  }
  if (ed.op === 'chart') return chart(deck, ed)
  return null
}

function shape(deck, id) {
  var slides = deck.getSlides()
  for (var i = 0; i < slides.length; i++) {
    var hit = slides[i].getShapes().filter(function (sh) { return sh.getObjectId() === id })[0]
    if (hit) return hit
  }
  return null
}

function title(slide, text) {
  var t = slide.getPlaceholder(SlidesApp.PlaceholderType.TITLE)
  if (t) t.asShape().getText().setText(text)
  else slide.insertTextBox(text, 40, 20, 640, 50).getText().getTextStyle().setFontSize(28).setBold(true)
}

// A bar chart drawn from shapes, so it needs no spreadsheet and shows up in one write.
function chart(deck, ed) {
  var s = deck.insertSlide(Math.min(ed.after, deck.getSlides().length), SlidesApp.PredefinedLayout.TITLE_ONLY)
  title(s, ed.title)
  var vals = ed.values.map(Number)
  var max = Math.max.apply(null, vals) || 1
  var left = 60, bottom = 350, height = 220, col = 600 / vals.length
  vals.forEach(function (v, i) {
    var bh = Math.max(3, (height * v) / max)
    var x = left + i * col + col * 0.15
    var bar = s.insertShape(SlidesApp.ShapeType.RECTANGLE, x, bottom - bh, col * 0.7, bh)
    bar.getFill().setSolidFill('#1A73E8')
    bar.getBorder().setTransparent()
    label(s, String(ed.labels && ed.labels[i] != null ? ed.labels[i] : ''), x, bottom + 6, col * 0.7, false)
    label(s, (ed.prefix || '') + v + (ed.suffix || ''), x, bottom - bh - 26, col * 0.7, true)
  })
  return s
}

function label(slide, text, x, y, w, bold) {
  var tb = slide.insertTextBox(text, x - 10, y, w + 20, 22)
  tb.getText().getTextStyle().setFontSize(14).setBold(bold)
  tb.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER)
}

function find(keywords) {
  var q = keywords
    .map(function (k) { return String(k).replace(/['\\]/g, ' ').trim() })
    .filter(String)
    .map(function (k) { return "title contains '" + k + "' or fullText contains '" + k + "'" })
    .join(' or ')
  // Keyword hits plus files touched this week: "your slides" is usually the deck just presented.
  var week = new Date(Date.now() - 7 * 86400000).toISOString()
  var hits = collect(DriveApp.searchFiles((q ? '(' + q + ') and ' : '') + 'trashed = false'), 8)
  var recent = collect(DriveApp.searchFiles("modifiedDate > '" + week + "' and trashed = false"), 6)
  var seen = {}
  return recent.concat(hits).filter(function (f) { return !seen[f.id] && (seen[f.id] = true) })
}

function collect(it, n) {
  var out = []
  while (it.hasNext() && out.length < 40) {
    var f = it.next()
    if (f.getMimeType() === MimeType.FOLDER) continue
    out.push({ id: f.getId(), name: f.getName(), type: f.getMimeType(), modified: f.getLastUpdated().toISOString(), url: f.getUrl() })
  }
  out.sort(function (a, b) { return a.modified < b.modified ? 1 : -1 })
  return out.slice(0, n)
}

// Shares the file with the requester and emails it: attached when it is a regular
// file under 10 MB, always with the link.
function share(req) {
  var f = DriveApp.getFileById(req.id)
  try {
    f.addViewer(req.guest)
  } catch (err) {
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
  }
  var opts = {}
  if (f.getMimeType().indexOf('application/vnd.google-apps') !== 0 && f.getSize() < 10e6) opts.attachments = [f.getBlob()]
  MailApp.sendEmail(req.guest, f.getName(), (req.note ? req.note + '\n\n' : '') + f.getUrl(), opts)
  return true
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)
}
