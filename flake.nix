{
  description = "Client-side tracker for nixpkgs PR branch merge status";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-parts,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        {
          pkgs,
          ...
        }:
        let
          # Matches the pnpm-lock.yaml format; bump together with the lockfile.
          pnpm = pkgs.pnpm_10;
        in
        {
          devShells.default =
            let
              inherit (pkgs) mkShell nodejs;
            in
            mkShell {
              packages = [
                nodejs
                pnpm
              ];
            };

          packages = rec {
            nixpkgs-tracker = pkgs.stdenv.mkDerivation rec {
              pname = "nixpkgs-tracker";
              version =
                let
                  lastModifiedDate = self.lastModifiedDate or self.lastModified or "19700101";
                in
                builtins.substring 0 8 lastModifiedDate;

              src = ./.;

              pnpmDeps = pkgs.fetchPnpmDeps {
                inherit pname version src pnpm;
                fetcherVersion = 5;
                hash = "sha256-++fI9GKg8yFEFwCgGSgTLITt19KcH7X9wf4/UeMzXBI=";
              };

              nativeBuildInputs = [
                pkgs.nodejs
                pkgs.pnpmConfigHook
                pnpm
              ];

              buildPhase = ''
                runHook preBuild
                pnpm build
                runHook postBuild
              '';

              installPhase = ''
                runHook preInstall

                mkdir -p $out
                cp -r dist $out/

                runHook postInstall
              '';
            };

            default = nixpkgs-tracker;
          };
        };
    };
}
