# MCA Notes

A free, static study website of **questions and answers** for three MCA subjects:

- Information Security (Semester 2)
- Distributed Systems and Cloud Computing (Semester 3)
- Ethical Hacking (Semester 3)

It is hosted on GitHub Pages. GitHub is the only backend: every chapter's Q&A is one `.md` or `.html` file in this repo, and an admin area in the browser edits those files through the GitHub REST API.

There is no build step: plain HTML, CSS and vanilla JavaScript (ES modules).

## Run locally

`fetch` does not work on `file://`, so serve the folder over http:

```
python -m http.server 8000
```

Then open <http://localhost:8000>. The VS Code Live Server extension also works.

## Folder layout

```
/
├─ .nojekyll                  # required: serve .md files raw on GitHub Pages
├─ index.html                 # Home
├─ subject.html               # Chapter list for one subject
├─ chapter.html               # Q&A for one chapter
├─ admin/                     # Browser admin (GitHub token, editor, guide)
├─ assets/
│  ├─ css/                    # style.css, admin.css
│  └─ js/                     # data.js, parsers, pages, admin/
├─ data/subjects.json         # Syllabus: subjects, groups, chapters
├─ templates/                 # qa-template.md, qa-template.html
└─ qa/
   ├─ sem-2/information-security/
   └─ sem-3/
      ├─ distributed-systems-cloud-computing/
      └─ ethical-hacking/
```

Routing uses query strings, e.g. `subject.html?s=information-security` and `chapter.html?s=information-security&ch=02`.

## Naming convention

```
qa/sem-<N>/<subject-slug>/ch<NN>-<chapter-slug>.md      (or .html)
qa/sem-<N>/<subject-slug>/images/ch<NN>-<image-name>.png
```

- Lowercase, words joined with single hyphens.
- The chapter number is always two digits: `ch01` … `ch14`.
- Slug rule: lowercase, `&` becomes `and`, every run of characters outside `a-z0-9` becomes `-`, trim leading and trailing `-`. For example "Authentication – I" becomes `authentication-i`.
- Exactly one Q&A file per chapter, either `.md` or `.html`, never both.
- Marks are only 5 or 10.

See [templates/](templates/) for the file formats.
