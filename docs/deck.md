# Wasit deck

**[Open the deck (PDF)](wasit-deck.pdf)**: ten slides, Wave 2 version 2 (14 Nov 2026).

It is built from one data file, [`deck/slides.json`](deck/slides.json), with the real app captures
in [`deck/assets/`](deck/assets/). Rebuild it with headless Chrome:

```sh
node docs/deck/build.mjs   # writes docs/wasit-deck.pdf; set CHROME if Chrome is not found
```

Every number on a slide comes from the testnet deployment, the test suite or a source named on the
slide. Nothing in it is a projection.
