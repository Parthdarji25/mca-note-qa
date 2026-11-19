# MCA Notes

A free, static study website of **questions and answers** for three MCA subjects:

- Information Security (Semester 2)
- Distributed Systems and Cloud Computing (Semester 3)
- Ethical Hacking (Semester 3)

It is hosted on GitHub Pages. GitHub is the only backend: each subject's questions are one `.md` or `.html` file in this repo, and an admin area in the browser edits that file through the GitHub REST API.

There are no chapters to click through. Each subject is a single list of questions. Every question has marks (5 or 10) and two optional tags that readers can filter by: a **chapter** label and the **years** it was asked (for example 2024, 2025, 2026).

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
├─ subject.html               # Q&A reader for one subject (filters, progress)
├─ admin/                     # Browser admin (GitHub token, editor, guide)
├─ assets/
│  ├─ css/                    # style.css, admin.css
│  └─ js/                     # data.js, parsers, pages, admin/
├─ data/subjects.json         # Subjects, their question file and question count
├─ templates/                 # qa-template.md, qa-template.html
└─ qa/
   ├─ sem-2/information-security/
   └─ sem-3/
      ├─ distributed-systems-cloud-computing/
      └─ ethical-hacking/
```

Routing uses query strings, e.g. `subject.html?s=information-security`. Filters are kept in the address too, so a filtered view can be shared: `subject.html?s=information-security&marks=10&year=2025&chapter=Cryptography`.

## Naming convention

```
qa/sem-<N>/<subject-slug>/questions.md      (or questions.html)
qa/sem-<N>/<subject-slug>/images/<image-name>.png
```

- Lowercase, words joined with single hyphens.
- Slug rule: lowercase, `&` becomes `and`, every run of characters outside `a-z0-9` becomes `-`, trim leading and trailing `-`. For example "Distributed Systems & Cloud Computing" becomes `distributed-systems-cloud-computing`. Image names are made from the uploaded file name the same way.
- Exactly one Q&A file per subject, either `.md` or `.html`, never both.
- Marks are only 5 or 10.

See [templates/](templates/) for the file formats.

## Adding questions

You can add or edit questions in the browser with the admin area, or edit the files in the repository directly.

### With the admin area

1. Open `/admin/` on the live site (or <http://localhost:8000/admin/> locally).
2. Create a **fine-grained personal access token**: GitHub, Settings, Developer settings, Fine-grained tokens. Choose this repository only, set **Contents: Read and write**, and give it an expiry date.
3. Paste the token on the Connect page. By default it is kept only until you close the tab. It is sent to `api.github.com` and nowhere else, and it is never stored in the repository.
4. Open **Questions**, pick a subject, then **Add question** (or **Edit** / **Delete** on a row). The list can be searched and filtered by marks, year and chapter.
5. In the editor, write the question and answer, and optionally give it a **chapter tag** and the **years asked** (tap a year or type `2024, 2025`). **Question no.** sets where it appears in the list. Or switch to **Import .html file** to add a ready-made file of questions to the end of the list. Use **Upload image** to add pictures.
6. Check the **Files changed** list, then **Commit and push**. One commit updates the subject's question file and `data/subjects.json` together. The live site updates in about a minute. After adding a question the form clears for the next one and keeps its tags, so a whole exam paper can be entered quickly.

The **Format guide** in the admin area has full examples and the syntax tables.

### File format

Every subject is one file: `.md` or `.html`. Marks are only 5 or 10. The `Chapter:` and `Years:` lines (and `data-chapter` / `data-years` in HTML) are optional.

Markdown:

```md
## Q1. What is cryptography? Explain its goals.
Marks: 5
Chapter: Cryptography
Years: 2024, 2025

Answer in Markdown, with lists, tables, code blocks, images and links.

> **Remember:** a blockquote that starts with Remember becomes a highlighted note.
```

HTML:

```html
<section class="question" data-marks="5" data-chapter="Cryptography" data-years="2024,2025">
  <h2>What is cryptography? Explain its goals.</h2>
  <div class="answer">
    <p>Answer here.</p>
    <blockquote class="note"><strong>Remember:</strong> highlighted note.</blockquote>
  </div>
</section>
```

All answers are sanitised with DOMPurify before they are shown. Scripts, styles, iframes, forms, inline styles, `on...` attributes and `javascript:` links are removed. Starting points are in [templates/](templates/).

If you edit files by hand, also update `data/subjects.json` (`file` and `questions` for the subject), or the site will show the subject as "Coming soon".

## Deploy

The site is plain static files, so GitHub Pages serves it directly.

1. Push the repository to GitHub.
2. In the repository, open Settings, then Pages. Under Build and deployment choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Keep the `.nojekyll` file at the root. Without it Jekyll would process the `.md` files instead of serving them raw.
4. The site is then served at `https://<user>.github.io/<repo>/`. All links in the site are relative, so it works from that sub-path as well as from a custom domain.

Changes you push to `main` (or commit from the admin area) go live in about a minute. `404.html` is served for missing pages.
