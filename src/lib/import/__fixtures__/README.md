# Import fixtures (dev only)

Small synthetic Google Places-shaped JSON files used to exercise the admin
import workflow end-to-end without any production data.

These files are NOT loaded by the app at runtime — they are meant to be
uploaded manually through the admin import wizard exactly the way a real
administrator would upload a real dataset. The importer must remain
schema-driven; nothing in the pipeline should special-case any of these
files.

| File | Contents |
| ---- | -------- |
| `small_flat.json` | 3 places in the flat Google array shape (1 insert, 1 with categories requiring mapping, 1 invalid because it lacks `place_id`). |
| `small_nested.json` | 2 places in the `{ business, reviews, images }` nested shape used by newer exports. |
| `single_places_wrapper.json` | 1 place wrapped in `{ places: [...] }`. |

To generate a version of `small_flat.json` you can drop into the admin UI:

```
cp src/lib/import/__fixtures__/small_flat.json /tmp/small_flat.json
```

Then open `/{lang}/admin/imports`, upload the file, and walk the wizard.
