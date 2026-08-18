# Local ADOFAI replay assets

This directory is intentionally git-ignored except for this README.

The replay visualizer can embed locally extracted ADOFAI textures into the generated standalone HTML. Do not commit the game assets to ELF.

Copy these files from an AssetRipper/AssetStudio `Texture2D` export into this directory, or pass the export directory with `--assets`:

- `tile_unlit.png`
- `planet-red.png`
- `planet-blue.png`
- `swirl_red.png`
- `swirl_blue.png`
- `SetSpeed.png` (rabbit / speed up)
- `SpeedDown.png` (snail / speed down)
- `tile_samespeed.png`

Example:

```powershell
npm run analyzer:fingering:view -- .\result.json .\replay.html --assets "C:\path\to\Texture2D"
```

If `--assets` is omitted, the visualizer looks in this directory automatically. Missing assets fall back to the built-in vector renderer.
