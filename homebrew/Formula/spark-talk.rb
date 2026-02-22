class SparkTalk < Formula
  desc "SQLite-backed local broker CLI for relaying messages between Spark Talk threads"
  homepage "https://github.com/ahdiverse/spark-talk"
  url "https://github.com/ahdiverse/spark-talk/releases/download/v1.0.1/spark-talk-1.0.1.tgz"
  sha256 "13a9b44ca15e9c262311a7509f9b64aec040510b7d7cf7cdf9b11d1c920864b7"
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
