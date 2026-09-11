{
  description = "Environnement de dev pour l'API du tournoi (Cloudflare Worker + Wrangler)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs
            pkgs.wrangler
            # Les outils de outils/ sont en Python, sans dépendance : la
            # bibliothèque standard suffit, mais encore faut-il l'avoir.
            pkgs.python3
          ];

          shellHook = ''
            echo "Environnement prêt : node $(node --version), wrangler $(wrangler --version), $(python3 --version)"
            echo "Commandes utiles :"
            echo "  wrangler login"
            echo "  wrangler kv namespace create TOURNOI_KV"
            echo "  wrangler deploy"
            echo "  python3 outils/vers-grist.py --help"
          '';
        };
      });
}
