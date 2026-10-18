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

## Adding questions

You can add or edit questions in the browser with the admin area, or edit the files in the repository directly.

### With the admin area

1. Open `/admin/` on the live site (or <http://localhost:8000/admin/> locally).
2. Create a **fine-grained personal access token**: GitHub, Settings, Developer settings, Fine-grained tokens. Choose this repository only, set **Contents: Read and write**, and give it an expiry date.
3. Paste the token on the Connect page. By default it is kept only until you close the tab. It is sent to `api.github.com` and nowhere else, and it is never stored in the repository.
4. Open **Chapters**, pick a subject, then **Create file** (or **Edit**) on a chapter. **Add chapter** creates a chapter that is not in the syllabus yet.
5. Either write the questions in the cards, or switch to **Upload .html file** and drop in a ready-made file. Use **Upload image** to add pictures.
6. Check the **Files changed** list, then **Commit and push**. One commit updates the Q&A file and `data/subjects.json` together. The live site updates in about a minute.

The **Format guide** in the admin area has full examples and the syntax tables.

### File format

Every chapter is one file: `.md` or `.html`. Marks are only 5 or 10.

Markdown:

```md
## Q1. What is cryptography? Explain its goals.
Marks: 5

Answer in Markdown, with lists, tables, code blocks, images and links.

> **Remember:** a blockquote that starts with Remember becomes a highlighted note.
```

HTML:

```html
<section class="question" data-marks="5">
  <h2>What is cryptography? Explain its goals.</h2>
  <div class="answer">
    <p>Answer here.</p>
    <blockquote class="note"><strong>Remember:</strong> highlighted note.</blockquote>
  </div>
</section>
```

All answers are sanitised with DOMPurify before they are shown. Scripts, styles, iframes, forms, inline styles, `on...` attributes and `javascript:` links are removed. Starting points are in [templates/](templates/).

If you edit files by hand, also update `data/subjects.json` (`file` and `questions` for the chapter), or the site will show the chapter as "Coming soon".

## Deploy

The site is plain static files, so GitHub Pages serves it directly.

1. Push the repository to GitHub.
2. In the repository, open Settings, then Pages. Under Build and deployment choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Keep the `.nojekyll` file at the root. Without it Jekyll would process the `.md` files instead of serving them raw.
4. The site is then served at `https://<user>.github.io/<repo>/`. All links in the site are relative, so it works from that sub-path as well as from a custom domain.

Changes you push to `main` (or commit from the admin area) go live in about a minute. `404.html` is served for missing pages.
