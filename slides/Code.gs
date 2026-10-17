// Apps Script web app bound to the demo deck. Deploy: Extensions > Apps Script,
// paste this, Deploy > New deployment > Web app, execute as Me, access Anyone.
// Put the /exec URL in bridge/.env as SLIDES_SCRIPT_URL.

function deck() {
  return SlidesApp.getActivePresentation()
}

function outline() {
  return {
    slides: deck().getSlides().map(function (s, i) {
      return {
        n: i + 1,
        id: s.getObjectId(),
        texts: s.getShapes()
          .filter(function (sh) { return sh.getText && sh.getText().asString().trim() })
          .map(function (sh) { return { id: sh.getObjectId(), text: sh.getText().asString().trim().slice(0, 300) } }),
      }
    }),
  }
}

function shape(id) {
  var slides = deck().getSlides()
  for (var i = 0; i < slides.length; i++) {
    var shapes = slides[i].getShapes()
    for (var j = 0; j < shapes.length; j++) if (shapes[j].getObjectId() === id) return shapes[j]
  }
  throw new Error('no shape ' + id)
}

function apply(edits) {
  edits.forEach(function (e) {
    if (e.op === 'setText') shape(e.shapeId).getText().setText(e.text)
    else if (e.op === 'replace') deck().getSlides()[e.slide - 1].replaceAllText(e.find, e.replace)
    else if (e.op === 'addBullet') shape(e.shapeId).getText().appendParagraph(e.text)
    else if (e.op === 'addSlide') {
      var s = deck().insertSlide(e.after, SlidesApp.PredefinedLayout.TITLE_AND_BODY)
      s.getPlaceholder(SlidesApp.PlaceholderType.TITLE).asShape().getText().setText(e.title)
      s.getPlaceholder(SlidesApp.PlaceholderType.BODY).asShape().getText().setText(e.body)
    }
  })
}

function doPost(e) {
  var req = JSON.parse(e.postData.contents)
  if (req.op === 'apply') apply(req.edits)
  return ContentService.createTextOutput(JSON.stringify(outline())).setMimeType(ContentService.MimeType.JSON)
}
