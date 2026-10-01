import Config

config :slovo, ecto_repos: [Slovo.Repo]

# Every extension sync is a query; keep SQL out of the logs.
config :logger, level: :info
