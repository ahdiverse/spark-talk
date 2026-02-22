class SparkTalk < Formula
  desc "SQLite-backed local broker CLI for relaying messages between Codex threads"
  homepage "https://github.com/ahdiverse/spark-talk"
  url "https://github.com/ahdiverse/spark-talk/releases/download/v1.0.1/spark-talk-1.0.1.tgz"
  sha256 "06b381d696c7a89fa4be7500cc2ebc129b03b8aa75454dc6c9710241da835f14"
  license "Apache-2.0"

  depends_on "node@22"

  def install
    libexec.install Dir["*"]

    cd libexec do
      system Formula["node@22"].opt_bin/"npm", "install", "--omit=dev"
    end

    (bin/"spark").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/dist/cli.js" "$@"
    EOS
  end

  test do
    assert_match "1.0.1", shell_output("#{bin}/spark --version").strip
  end
end
