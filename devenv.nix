{
  pkgs,
  lib,
  ...
}:

{
  packages = with pkgs; [
    git
    hugo
    blowfish-tools
  ];

  processes.hugo.exec = lib.strings.concatStringsSep " " [
    "${lib.getExe pkgs.hugo}"
    "serve"
    "--openBrowser"
    "--buildDrafts"
    "--buildFuture"
  ];

  # https://devenv.sh/services/
  # services.postgres.enable = true;

  # https://devenv.sh/scripts/
  # scripts.hello.exec = ''
  #   echo hello from $GREET
  # '';

  # https://devenv.sh/basics/
  # enterShell = ''
  #   hello         # Run scripts directly
  #   git --version # Use packages
  # '';

  # https://devenv.sh/tasks/
  tasks = {
    "git:submoduleInit".exec = "${lib.getExe pkgs.git} submodule update --init --recursive";
    "git:submoduleUpdate".exec = "${lib.getExe pkgs.git} submodule update --remote --merge";
  };

  # https://devenv.sh/tests/
  # enterTest = ''
  #   echo "Running tests"
  #   git --version | grep --color=auto "${pkgs.git.version}"
  # '';

  # https://devenv.sh/git-hooks/
  # git-hooks.hooks.shellcheck.enable = true;
}
