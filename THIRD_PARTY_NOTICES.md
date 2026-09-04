# Third-Party Notices

This package bundles third-party JavaScript and font files into `dist/`.
Dependency versions are pinned in `pnpm-lock.yaml`.

## Direct Runtime Dependencies

| Component | Version | License |
|---|---:|---|
| `@excalidraw/excalidraw` | 0.18.0 | MIT |
| `@modelcontextprotocol/ext-apps` | 1.7.5 | MIT |
| `@modelcontextprotocol/sdk` | 1.30.0 | MIT |
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |
| `zod` | 4.4.3 | MIT |

Their transitive runtime dependencies use permissive or reciprocal licenses,
including MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0,
EPL-2.0, MPL-2.0, Zlib, and the Unlicense. Run
`pnpm licenses list --prod` against the locked dependency graph before a
public release and retain the license texts required by that graph.

## Fonts

The App Resource embeds fonts distributed by `@excalidraw/excalidraw`,
including Assistant, Cascadia Code, Comic Shanns, Excalifont, Liberation Sans,
Lilita One, Nunito, Virgil, and Xiaolai. These fonts remain under their
respective upstream licenses and are not relicensed by this project.

The project license in [`LICENSE`](LICENSE) applies only to this project's
original code and documentation.
