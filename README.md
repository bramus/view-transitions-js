# [ViewTransitions.js](https://github.com/bramus/view-transitions-js)

A JavaScript implementation of [`css-view-transitions-1`](https://drafts.csswg.org/css-view-transitions-1/) _(May 2, 2025 Snapshot)_.

⚠️ DO NOT USE THIS IN PRODUCTION. THIS IS AN EXPERIMENT, NOT A POLYFILL.

## NOTES/CAVEATS/LIMITATIONS

- This library captures the snapshots to a `<canvas>` using https://html2canvas.hertzen.com/
  which comes with limitations:

  - Limited CSS support – See https://html2canvas.hertzen.com/features
  - No way to capture ink overflow
  - External images are not captured (unless you do some special `crossorigin` attribute things)

- Because I also use html2canvas to capture the new snapshot, the new snapshot is not a live one.
  (if only we had [`element()`](https://developer.mozilla.org/en-US/docs/Web/CSS/element)
  in all browsers … that would allow that!)

- Render suppression is not implemented, as that is something that needs to be implemented by
  User-Agents (aka Browsers). I think I can work around this by taking an extra snapshot and render
  that on top, but I didn’t look into it. As a result, you’ll see a glitching frame
  before the VT starts.

- Speaking of things to implement: I also need to implement skipping of a transition when the SCB
  or page visibility changes. This is very easy to do, but I – again – didn’t bother doing it.

- Speaking of the SCB (Snapshot Containing Block): it’s always sized to the viewport here instead
  of reaching into the omnibox region. (Safari also does this, BTW).

- Styling is a bit different, because instead of creating pseudos I create divs that mimic the
  pseudos. E.g. `::view-transition-group(box)` ~> `[data-pseudo="::view-transition-group(box)"]`

- The list of elements that need to be captured cannot be auto-found but depends on a
  snapshotConfig object. A workaround can be made by setting the VT name through an attribute.

- Speaking of the `view-transition-name` property: you need to set it through a 
  `--view-transition-name` custom prop. To prevent this from inheriting it is registered
  using @property, which kinda limits the set of supported browsers.

- There are also some non-spec compliant things in this implementation. Look for “non-spec-compliant”
  in the code.

- I have not tested this with more than 1 element to capture … or with different elements
  on both ends of the VT. I’m quite sure the snapshotting will be messed up.
  (I did test `pointer-events: none` on ::view-transition, though … and it skips correctly)

So, again: ⚠️ DO NOT USE THIS IN PRODUCTION. THIS IS AN EXPERIMENT, NOT A POLYFILL.

## License

Licensed under the [MIT License](./LICENSE).
