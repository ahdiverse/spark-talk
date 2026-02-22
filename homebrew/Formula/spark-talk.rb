class SparkTalk < Formula
  desc "SQLite-backed local broker CLI for relaying messages between Codex threads"
  homepage "https://github.com/ahdiverse/spark-talk"
  url "https://github.com/ahdiverse/spark-talk/releases/download/v1.0.0/talk-broker-1.0.0.tgz"
  sha256 "4560c08da2740d9abc73037e463f492234bfc3f6690e90b9bfcd712e8b0ec452"
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
    assert_match "1.0.0", shell_output("#{bin}/spark --version").strip
  end
end
