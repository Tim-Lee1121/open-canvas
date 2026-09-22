# Third-party notices

Dependencies are installed from `pnpm-lock.yaml`, not copied into this repository. The locked development install was audited with `pnpm licenses list --json`; it reports 285 packages across MIT (241), Apache-2.0 (16), ISC (12), BSD-2-Clause (8), BSD-3-Clause (3), and the single-package licenses MIT-0, 0BSD, BlueOak-1.0.0, Python-2.0, and CC-BY-4.0. Run the command again after dependency changes and review the complete output before a release.

- `@hugeicons/core-free-icons` and `@hugeicons/react`: MIT. The application uses these packages at runtime; icons in the public demo are original paths and do not require external assets.
- `caniuse-lite`: CC-BY-4.0; compatibility dataset installed as a transitive development dependency. Attribution: [caniuse-lite](https://github.com/browserslist/caniuse-lite), Can I Use contributors, CC BY 4.0.
- `argparse`: Python-2.0; transitive development dependency. Retain its package license when distributing bundled dependencies.
- `minimatch`: BlueOak-1.0.0; transitive development dependency. Retain its package license when distributing bundled dependencies.

No photographs, brand illustrations, or fonts are bundled in the public demo. Generated pages outside `generated-pages/demo/` are local user artifacts and excluded from the public repository. The OpenAI and Figma marks remain the property of their respective owners.
