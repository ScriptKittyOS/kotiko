# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.ExposureTest do
  use ExUnit.Case, async: true
  alias Slovo.Exposure

  @cases [
    {{127, 0, 0, 1}, :info, :loopback},
    {{127, 1, 2, 3}, :info, :loopback},
    {{0, 0, 0, 0, 0, 0, 0, 1}, :info, :loopback},
    {{100, 64, 0, 1}, :info, :tailscale},
    {{100, 127, 255, 254}, :info, :tailscale},
    {{0xFD7A, 0x115C, 0xA1E0, 0, 0, 0, 0, 1}, :info, :tailscale},
    {{10, 1, 2, 3}, :warning, :lan},
    {{172, 16, 0, 1}, :warning, :lan},
    {{172, 31, 255, 255}, :warning, :lan},
    {{192, 168, 1, 5}, :warning, :lan},
    {{169, 254, 1, 1}, :warning, :lan},
    {{0xFD00, 0, 0, 0, 0, 0, 0, 1}, :warning, :lan},
    {{0xFE80, 0, 0, 0, 0, 0, 0, 1}, :warning, :lan},
    {{0, 0, 0, 0}, :warning, :all},
    {{0, 0, 0, 0, 0, 0, 0, 0}, :warning, :all},
    {{100, 128, 0, 1}, :warning, :public},
    {{172, 32, 0, 1}, :warning, :public},
    {{8, 8, 8, 8}, :warning, :public},
    {{0x2001, 0xDB8, 0, 0, 0, 0, 0, 1}, :warning, :public}
  ]

  for {ip, level, class} <- @cases do
    test "#{:inet.ntoa(ip)} is #{class}" do
      assert {unquote(level), unquote(class), message} =
               Exposure.classify(unquote(Macro.escape(ip)), "http://x:4747")

      assert message =~ "http://x:4747"
      if unquote(level) == :warning, do: assert(message =~ "plain HTTP")
    end
  end

  test "loopback says this computer only" do
    assert {:info, :loopback, "Listening on this computer only (http://127.0.0.1:4747)."} =
             Exposure.classify({127, 0, 0, 1}, "http://127.0.0.1:4747")
  end

  test "server_url prefers PUBLIC_URL, else BIND and PORT" do
    assert Exposure.server_url("https://mira.example/", {0, 0, 0, 0}, 4747) ==
             "https://mira.example"

    assert Exposure.server_url(nil, {127, 0, 0, 1}, 4747) == "http://127.0.0.1:4747"
    assert Exposure.server_url(nil, {0, 0, 0, 0, 0, 0, 0, 1}, 4747) == "http://[::1]:4747"
    assert "http://" <> rest = Exposure.server_url(nil, {0, 0, 0, 0}, 4747)
    assert rest =~ ~r/\A\d+\.\d+\.\d+\.\d+:4747\z/
    refute rest =~ "0.0.0.0"
  end
end
