[
  import_deps: [:ecto, :ecto_sql, :plug],
  subdirectories: ["priv/*/migrations"],
  inputs: ["{mix,.formatter}.exs", "{config,lib}/**/*.{ex,exs}"]
]
