"""
CLI entry-point for the ``manga-readme`` package.

Usage examples:
    manga-readme serve
    manga-readme serve --port 7860 --model dreamshaper-8
    manga-readme serve --model sdxl --lora-dir ./my-loras
    manga-readme list-models
"""

from __future__ import annotations

import argparse
import logging
import sys
import textwrap

from manga_readme import __version__


def _build_parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="manga-readme",
        description="Local AI image-generation server for MangaREADME Generator.",
    )
    root.add_argument(
        "--version", action="version", version=f"manga-readme {__version__}"
    )
    sub = root.add_subparsers(dest="command")

    # -- serve ---------------------------------------------------------------
    serve = sub.add_parser(
        "serve",
        help="Start the image-generation server.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=textwrap.dedent("""\
            Start a local REST server (A1111-compatible API) backed by
            HuggingFace Diffusers.  The MangaREADME frontend can connect
            to it out-of-the-box via the 'Local Server' provider.
        """),
    )
    serve.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind address (default: 127.0.0.1).",
    )
    serve.add_argument(
        "--port",
        type=int,
        default=7860,
        help="Port number (default: 7860).",
    )
    serve.add_argument(
        "--model",
        default=None,
        help=(
            "Model to pre-load on startup.  "
            "Can be an alias (dreamshaper-8, sdxl, sd15, ...) "
            "or a HuggingFace repo id (Lykon/dreamshaper-8). "
            "Default: dreamshaper-8."
        ),
    )
    serve.add_argument(
        "--lora-dir",
        default="./loras",
        help="Directory containing LoRA files (default: ./loras).",
    )
    serve.add_argument(
        "--no-half",
        action="store_true",
        help="Disable half-precision (fp16). Use on CPU or if you see NaN outputs.",
    )
    serve.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development.",
    )

    # -- list-models ---------------------------------------------------------
    sub.add_parser(
        "list-models",
        help="Print the list of curated models and exit.",
    )

    return root


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-28s  %(levelname)-5s  %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.command == "list-models":
        _cmd_list_models()
    elif args.command == "serve":
        _cmd_serve(args)
    else:
        parser.print_help()


# ---------------------------------------------------------------------------
#  Commands
# ---------------------------------------------------------------------------

def _cmd_list_models() -> None:
    from manga_readme.models import list_models

    models = list_models()
    header = f"{'Alias':<20} {'Arch':<6} {'Resolution':<12} Repo ID"
    print(header)
    print("-" * len(header))
    for m in models:
        res = f"{m.default_width}x{m.default_height}"
        print(f"{m.alias:<20} {m.arch:<6} {res:<12} {m.repo_id}")


def _cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn
    from manga_readme.pipeline import configure, load_model

    configure(lora_dir=args.lora_dir)

    model_id = args.model or "dreamshaper-8"
    halfp = not args.no_half

    print(f"manga-readme v{__version__}")
    print(f"  Model   : {model_id}")
    print(f"  Device  : cuda (fp16)" if halfp else f"  Device  : cpu (fp32)")
    print(f"  LoRA dir: {args.lora_dir}")
    print(f"  Server  : http://{args.host}:{args.port}")
    print()

    load_model(model_id, half=halfp)

    uvicorn.run(
        "manga_readme.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
